"use client";
import { useState, useEffect, useRef, forwardRef } from "react";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import SiriWave from "siriwave";

const sampleRate = 16000;

export default function Home() {
  const [recognitionText, setRecognitionText] = useState<string[]>([]);
  const [serverIp, setServerIp] = useState<string>("");
  const [serverPort, setServerPort] = useState<string>("");
  const [isRecording, setIsRecording] = useState<boolean>(false);

  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [microphone, setMicrophone] = useState<MediaStream | null>(null);
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [recorder, setRecorder] = useState<AudioWorkletNode | null>(null);
  const [source, setSource] = useState<MediaStreamAudioSourceNode | null>(null);
  const [isTopFaded, setIsTopFaded] = useState<boolean>(false);
  const [isBottomFaded, setIsBottomFaded] = useState<boolean>(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const siriWave = useRef<SiriWave | null>(null);

  // Initialize SiriWave
  useEffect(() => {
    siriWave.current = new SiriWave({
      container: document.getElementById("siri-container")!,
      width: 640,
      height: 200,
      style: "ios9",
      autostart: true,
      amplitude: 3,
      speed: 0.05,
    });
  }, []);

  useEffect(() => {
    let source: MediaStreamAudioSourceNode | null = null;
    let taskHandle = 0;
    let spectrum: Uint8Array;
    let dBASpectrum: Float32Array;

    // A-weighting
    // https://www.softdb.com/difference-between-db-dba/
    // https://en.wikipedia.org/wiki/A-weighting
    const RA = (f: number) =>
      (12194 ** 2 * f ** 4) /
      ((f ** 2 + 20.6 ** 2) *
        Math.sqrt((f ** 2 + 107.7 ** 2) * (f ** 2 + 737.9 ** 2)) *
        (f ** 2 + 12194 ** 2));
    const A = (f: number) => 20 * Math.log10(RA(f)) + 2.0;

    // see https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Visualizations_with_Web_Audio_API

    function run() {
      const audioStream = navigator.mediaDevices.getUserMedia({ audio: true });

      // Note that the visualisation itself is animated with fps_ani = 60 Hz ↷ interval_ani = 17 msec
      // ν
      const approxVisualisationUpdateFrequency = 5;
      // total sample time T = 1 / ν
      // sampling rate f
      // total number of samples N = f ∙ T

      audioStream
        .then((stream) =>
          Promise.all([stream, navigator.mediaDevices.enumerateDevices()]),
        )
        .then(([stream, devices]) => {
          let context = new window.AudioContext();
          //create source for sound input.
          source = context.createMediaStreamSource(stream);
          //create analyser node.
          let analyser = context.createAnalyser();

          const trackSettings = stream.getAudioTracks()[0].getSettings();
          const sampleRate = trackSettings.sampleRate || context.sampleRate; // Firefox does not support trackSettings.sampleRate
          const device = devices.find(
            (device) => device.deviceId === trackSettings.deviceId,
          );
          const deviceName = device?.label || "Unknown device";

          console.log(`sample rate: ${sampleRate} Hz, 
    audio context sample rate: ${context.sampleRate} Hz,
    dynamic: ${trackSettings.sampleSize} bit
    device: ${deviceName}`);

          let totalNumberOfSamples =
            sampleRate / approxVisualisationUpdateFrequency; // e.g. 48000 / 5 = 9600

          analyser.fftSize = 2 ** Math.floor(Math.log2(totalNumberOfSamples));

          const uint8TodB = (byteLevel: number) =>
            (byteLevel / 255) * (analyser.maxDecibels - analyser.minDecibels) +
            analyser.minDecibels;

          console.log(`frequency bins: ${analyser.frequencyBinCount}`);

          const weightings = [-100];
          for (let i = 1; i < analyser.frequencyBinCount; i++) {
            weightings[i] = A(
              (i * sampleRate) / 2 / analyser.frequencyBinCount,
            );
          }

          //array for frequency data.
          // holds Number.NEGATIVE_INFINITY, [0 = -100dB, ..., 255 = -30 dB]
          spectrum = new Uint8Array(analyser.frequencyBinCount);
          dBASpectrum = new Float32Array(analyser.frequencyBinCount);

          let waveForm = new Uint8Array(analyser.frequencyBinCount);

          //connect source->analyser->destination.
          source.connect(analyser);
          // noisy feedback loop if we put the mic on the speakers
          //analyser.connect(context.destination);

          siriWave.current!.start();

          const updateAnimation = function (idleDeadline: IdleDeadline) {
            taskHandle = requestIdleCallback(updateAnimation, {
              timeout: 1000 / approxVisualisationUpdateFrequency,
            });

            //copy frequency data to spectrum from analyser.
            // holds Number.NEGATIVE_INFINITY, [0 = -100dB, ..., 255 = -30 dB]
            analyser.getByteFrequencyData(spectrum);

            spectrum.forEach((byteLevel, idx) => {
              dBASpectrum[idx] = uint8TodB(byteLevel) + weightings[idx];
            });

            const highestPerceptibleFrequencyBin = dBASpectrum.reduce(
                (acc, y, idx) => (y > -90 ? idx : acc),
                0,
              ),
              // S = ∑ s_i
              totaldBAPower = dBASpectrum.reduce((acc, y) => acc + y),
              // s⍉ = ∑ s_i ∙ i / ∑ s_i
              meanFrequencyBin =
                dBASpectrum.reduce((acc, y, idx) => acc + y * idx) /
                totaldBAPower,
              highestPowerBin = dBASpectrum.reduce(
                ([maxPower, iMax], y, idx) =>
                  y > maxPower ? [y, idx] : [maxPower, iMax],
                [-120, 0],
              )[1],
              highestDetectedFrequency =
                highestPerceptibleFrequencyBin *
                (sampleRate / 2 / analyser.frequencyBinCount),
              meanFrequency =
                meanFrequencyBin *
                (sampleRate / 2 / analyser.frequencyBinCount),
              maxPowerFrequency =
                highestPowerBin * (sampleRate / 2 / analyser.frequencyBinCount);

            //set the speed for siriwave
            // scaled to [0..22kHz] -> [0..1]
            siriWave.current!.setSpeed(maxPowerFrequency / 10e3);

            const averagedBAPower = totaldBAPower / analyser.frequencyBinCount;

            //find the max amplituded
            // the zero level is at 128
            analyser.getByteTimeDomainData(waveForm);

            // find the maximum not considering negative values (without loss of generality)
            const amplitude =
              waveForm.reduce((acc, y) => Math.max(acc, y), 128) - 128;

            //scale amplituded from [0, 128] to [0, 10].
            siriWave.current!.setAmplitude((amplitude / 128) * 10);
          };

          taskHandle = requestIdleCallback(updateAnimation, {
            timeout: 1000 / approxVisualisationUpdateFrequency,
          });
        });
    }

    function stop() {
      cancelIdleCallback(taskHandle);
      siriWave.current!.setAmplitude(0);
      siriWave.current!.setSpeed(0);
      source!.disconnect();
      siriWave.current!.stop();
      source!.mediaStream.getAudioTracks()[0].stop();
    }

    if (isRecording) {
      run();
    } else if (!isRecording && source) {
      stop();
    }
  }, [isRecording]);

  // Update isFaded when the scroll position is changed
  useEffect(() => {
    textareaRef.current!.onscroll = () => {
      if (textareaRef.current!.scrollTop > 0) {
        setIsTopFaded(true);
      } else {
        setIsTopFaded(false);
      }
      if (
        textareaRef.current!.scrollHeight -
          textareaRef.current!.scrollTop -
          textareaRef.current!.clientHeight >
        25
      ) {
        setIsBottomFaded(true);
      } else {
        setIsBottomFaded(false);
      }
      if (
        textareaRef.current!.scrollHeight > textareaRef.current!.clientHeight
      ) {
        textareaRef.current!.style.height =
          textareaRef.current!.scrollHeight + "px";
      }
    };
  }, []);

  function getDisplayResult() {
    let i = 0;
    let ans = "";
    for (let s in recognitionText) {
      if (recognitionText[s] == "") continue;

      ans += "" + i + ": " + recognitionText[s] + "\n";
      i += 1;
    }
    return ans;
  }

  function initWebSocket() {
    console.log("Creating websocket");
    let protocol = "ws://";
    if (window.location.protocol == "https:") {
      protocol = "wss://";
    }
    let server_ip = serverIp || "localhost";
    let server_port = serverPort || "6006";
    console.log("protocol: ", protocol);
    console.log("server_ip: ", server_ip);
    console.log("server_port: ", server_port);

    let uri = protocol + server_ip + ":" + server_port;
    console.log("uri", uri);

    var socket: WebSocket;
    try {
      socket = new WebSocket(uri);
    } catch (e) {
      return null;
    }
    console.log("socket", socket);

    // Connection opened
    socket.onopen = function () {
      setIsRecording(true);
      console.log("connected");
    };

    // Connection closed
    socket.onclose = function () {
      setIsRecording(false);
      console.log("disconnected");
    };

    // Listen for messages
    socket.onmessage = function (event) {
      let message = JSON.parse(event.data);
      if (message.segment in recognitionText) {
        recognitionText[message.segment] = message.text;
      } else {
        recognitionText.push(message.text);
      }
      textareaRef.current!.value = getDisplayResult();
      if (
        textareaRef.current!.scrollHeight -
          textareaRef.current!.scrollTop -
          textareaRef.current!.clientHeight <
        25
      ) {
        textareaRef.current!.scrollTop = textareaRef.current!.scrollHeight; // auto scroll
      }

      console.log("Received message: ", event.data);
    };

    socket.onerror = function (event) {
      console.error("Socket error: ", event);
    };

    return socket;
  }

  function downsampleBuffer(buffer: Float32Array, recordSampleRate: number) {
    if (sampleRate === recordSampleRate) return buffer;
    var sampleRateRatio = recordSampleRate / sampleRate;
    var newLength = Math.round(buffer.length / sampleRateRatio);
    var result = new Float32Array(newLength);
    var offsetResult = 0;
    var offsetBuffer = 0;
    while (offsetResult < result.length) {
      var nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio);
      var accum = 0,
        count = 0;
      for (
        var i = offsetBuffer;
        i < nextOffsetBuffer && i < buffer.length;
        i++
      ) {
        accum += buffer[i];
        count++;
      }
      result[offsetResult] = accum / count;
      offsetResult++;
      offsetBuffer = nextOffsetBuffer;
    }
    return result;
  }

  async function startRecording() {
    const socket = initWebSocket();
    console.log("socket", socket);

    if (socket == null) {
      console.log("Websocket cannot be accessed");
      toast.error(
        "Websocket cannot be connected.\nPlease check the server and uri",
      );
      return;
    }
    if (!navigator.mediaDevices) {
      console.log("Cannot access microphone");
      toast.error("Cannot access microphone");
      return;
    }

    let leftchannel: Int16Array[] = [];
    let recordingLength = 0;

    const context = new AudioContext();
    // https://dev.to/louisgv/quick-guide-to-audioworklet-30df
    const microphone = await navigator.mediaDevices.getUserMedia({
      audio: true,
    });

    const source = context.createMediaStreamSource(microphone);
    // Loading the worklet processor
    await context.audioWorklet.addModule("/worklet.js");
    // Create the recorder worklet
    const recorder = new AudioWorkletNode(context, "recorder.worklet");

    source.connect(recorder);
    recorder.connect(context.destination);

    recorder.port.onmessage = (event) => {
      let samples = event.data as Float32Array;
      samples = downsampleBuffer(samples, context.sampleRate);

      let buf = new Int16Array(samples.length);
      for (var i = 0; i < samples.length; ++i) {
        let s = samples[i];
        if (s >= 1) s = 1;
        else if (s <= -1) s = -1;

        samples[i] = s;
        buf[i] = s * 32767;
      }

      socket.send(samples);

      leftchannel.push(buf);
      recordingLength += buf.length;
    };

    // console.log("recorder started");

    setSocket(socket);
    setMicrophone(microphone);
    setAudioContext(context);
    setRecorder(recorder);
    setSource(source);
  }

  function stopRecording() {
    if (socket == null) return;
    if (microphone == null) return;
    if (audioContext == null) return;
    if (recorder == null) return;
    if (source == null) return;

    socket.send("Done");
    // console.log("Sent Done");

    socket.close();

    microphone.getTracks().forEach((track) => track.stop());
    recorder.port.postMessage("stop");

    recorder.disconnect(audioContext.destination);
    source.disconnect(recorder);
    // console.log("recorder stopped");

    siriWave.current!.stop();

    setSocket(null);
    setMicrophone(null);
    setAudioContext(null);
    setRecorder(null);
    setSource(null);
  }

  const handleCopy = () => {
    if (textareaRef.current) {
      textareaRef.current.select();
      navigator.clipboard.writeText(textareaRef.current.value);
    }
  };

  const handleClear = () => {
    if (textareaRef.current) {
      textareaRef.current.value = "";
    }
  };

  return (
    <>
      <main className="flex min-h-screen flex-col items-center justify-between py-12 lg:p-24">
        <div className="relative flex place-items-center before:pointer-events-none before:absolute before:h-[300px] before:w-[480px] before:-translate-x-1/2 before:rounded-full before:bg-gradient-radial before:from-white before:to-transparent before:blur-2xl before:content-[''] after:pointer-events-none after:absolute after:-z-20 after:h-[180px] after:w-[240px] after:translate-x-1/3 after:bg-gradient-conic after:from-sky-200 after:via-blue-200 after:blur-2xl after:content-[''] before:dark:bg-gradient-to-br before:dark:from-transparent before:dark:to-blue-700 before:dark:opacity-10 after:dark:from-sky-900 after:dark:via-[#0141ff] after:dark:opacity-40 lg:gap-3 before:lg:h-[360px]">
          <p className="flex w-auto justify-center rounded-s-xl border border-gray-300 bg-gray-200 p-4 backdrop-blur-2xl dark:border-neutral-800 dark:bg-zinc-600/30 dark:from-inherit lg:rounded-xl">
            ws://
          </p>
          <input
            className="flex w-auto justify-center border border-gray-300 bg-white p-4 backdrop-blur-2xl dark:border-neutral-800 dark:bg-zinc-800/30 dark:from-inherit lg:rounded-xl"
            type="text"
            placeholder="localhost"
            value={serverIp}
            onChange={(e) => setServerIp(e.target.value)}
          />
          <p className="flex w-auto justify-center border border-gray-300 bg-gray-200 p-4 backdrop-blur-2xl dark:border-neutral-800 dark:bg-zinc-600/30 dark:from-inherit lg:rounded-xl">
            :
          </p>
          <input
            className="flex w-auto justify-center rounded-e-xl border border-gray-300 bg-white p-4 backdrop-blur-2xl dark:border-neutral-800 dark:bg-zinc-800/30 dark:from-inherit lg:rounded-xl"
            type="number"
            placeholder="6006"
            value={serverPort}
            onChange={(e) => setServerPort(e.target.value)}
          />
        </div>
        {/* <div className="relative flex place-items-center before:pointer-events-none before:absolute before:h-[300px] before:w-[480px] before:-translate-x-1/2 before:rounded-full before:bg-gradient-radial before:from-white before:to-transparent before:blur-2xl before:content-[''] after:pointer-events-none after:absolute after:-z-20 after:h-[180px] after:w-[240px] after:translate-x-1/3 after:bg-gradient-conic after:from-sky-200 after:via-blue-200 after:blur-2xl after:content-[''] before:dark:bg-gradient-to-br before:dark:from-transparent before:dark:to-blue-700 before:dark:opacity-10 after:dark:from-sky-900 after:dark:via-[#0141ff] after:dark:opacity-40 before:lg:h-[360px]">
          <h3 className="relative text-center text-3xl font-bold text-gray-900 dark:drop-shadow-[0_0_0.3rem_#ffffff70] dark:invert">
            Recognition from
            <br />
            real-time recordings
          </h3>
        </div> */}
        {/* Textarea with recognized text */}
        <div className="relative w-full max-w-5xl text-sm">
          <textarea
            ref={textareaRef}
            className="flex max-h-[50vh] min-h-[30vh] w-full justify-center border-y border-gray-300 bg-white/30 p-4 backdrop-blur-2xl dark:border-neutral-800 dark:bg-zinc-800/30 dark:from-inherit lg:rounded-xl lg:border"
            placeholder="Recognized text"
            // readOnly
          />

          {/* Fade upper part of textarea */}
          <div
            className={`pointer-events-none absolute inset-x-[1px] top-[1px] h-24 bg-gradient-to-b from-white dark:from-zinc-800/30 lg:rounded-xl ${
              isTopFaded ? "opacity-100" : "opacity-0"
            } transition-opacity duration-300`}
          />
          <div
            className={`pointer-events-none absolute inset-x-[1px] bottom-[1px] h-24 bg-gradient-to-t from-white dark:from-zinc-800/30 lg:rounded-xl ${
              isBottomFaded ? "opacity-100" : "opacity-0"
            } transition-opacity duration-300`}
          />

          {/* Copy text button */}
          <button
            type="button"
            className="absolute right-0 top-0 m-4 flex h-10 w-10 items-center justify-center rounded-md bg-white fill-gray-500 p-3 transition-colors hover:bg-gray-200 hover:from-inherit dark:bg-zinc-800/30 dark:from-inherit dark:fill-gray-300 dark:hover:bg-zinc-500/30 lg:rounded-lg"
            onClick={() => handleCopy()}
          >
            <svg
              aria-hidden="true"
              height="16"
              viewBox="0 0 16 16"
              version="1.1"
              width="16"
              data-view-component="true"
            >
              <path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z" />
              <path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z" />
            </svg>
          </button>

          {/* Clear text button */}
          <button
            type="button"
            className="absolute right-0 top-14 m-4 flex h-10 w-10 items-center justify-center rounded-md bg-white fill-gray-500 p-3 transition-colors hover:bg-gray-200 hover:from-inherit dark:bg-zinc-800/30 dark:from-inherit dark:fill-gray-300 dark:hover:bg-zinc-500/30 lg:rounded-lg"
            onClick={() => handleClear()}
          >
            <svg
              aria-hidden="true"
              height="16"
              viewBox="0 0 16 16"
              version="1.1"
              width="16"
              data-view-component="true"
            >
              {/* Circle */}
              <path
                fillRule="evenodd"
                d="M8 16A8 8 0 108 0a8 8 0 000 16z"
                clipRule="evenodd"
              />
              {/* Cross */}
              <path
                fillRule="evenodd"
                d="M10.828 5.172a.5.5 0 010 .707L8.707 8l2.121 2.121a.5.5 0 11-.707.707L8 8.707l-2.121 2.121a.5.5 0 11-.707-.707L7.293 8 5.172 5.879a.5.5 0 11.707-.707L8 7.293l2.121-2.122a.5.5 0 01.707 0z"
                clipRule="evenodd"
              />
            </svg>
          </button>

          {/* Start record button with text "Start recording" */}
          <button
            type="button"
            className="absolute bottom-0 right-0 m-4 flex justify-center rounded-md bg-blue-500 p-4 text-gray-100 transition-colors hover:bg-blue-600 hover:from-inherit dark:from-inherit dark:invert lg:rounded-lg"
            onClick={isRecording ? stopRecording : startRecording}
          >
            {isRecording ? "Stop recording" : "Start recording"}
          </button>
        </div>
        {/* <div className="mb-0 grid text-center lg:grid-cols-4 lg:text-left">
          <a
            href="https://nextjs.org/docs?utm_source=create-next-app&utm_medium=appdir-template&utm_campaign=create-next-app"
            className="group rounded-lg border border-transparent px-5 py-4 transition-colors hover:border-gray-300 hover:bg-gray-100 hover:dark:border-neutral-700 hover:dark:bg-neutral-800/30"
            target="_blank"
            rel="noopener noreferrer"
          >
            <h2 className={`mb-3 text-2xl font-semibold`}>
              Docs{" "}
              <span className="inline-block transition-transform group-hover:translate-x-1 motion-reduce:transform-none">
                -&gt;
              </span>
            </h2>
            <p className={`m-0 max-w-[30ch] text-sm opacity-50`}>
              Find in-depth information about Next.js features and API.
            </p>
          </a>

          <a
            href="https://nextjs.org/learn?utm_source=create-next-app&utm_medium=appdir-template-tw&utm_campaign=create-next-app"
            className="group rounded-lg border border-transparent px-5 py-4 transition-colors hover:border-gray-300 hover:bg-gray-100 hover:dark:border-neutral-700 hover:dark:bg-neutral-800 hover:dark:bg-opacity-30"
            target="_blank"
            rel="noopener noreferrer"
          >
            <h2 className={`mb-3 text-2xl font-semibold`}>
              Learn{" "}
              <span className="inline-block transition-transform group-hover:translate-x-1 motion-reduce:transform-none">
                -&gt;
              </span>
            </h2>
            <p className={`m-0 max-w-[30ch] text-sm opacity-50`}>
              Learn about Next.js in an interactive course with&nbsp;quizzes!
            </p>
          </a>

          <a
            href="https://vercel.com/templates?framework=next.js&utm_source=create-next-app&utm_medium=appdir-template&utm_campaign=create-next-app"
            className="group rounded-lg border border-transparent px-5 py-4 transition-colors hover:border-gray-300 hover:bg-gray-100 hover:dark:border-neutral-700 hover:dark:bg-neutral-800/30"
            target="_blank"
            rel="noopener noreferrer"
          >
            <h2 className={`mb-3 text-2xl font-semibold`}>
              Templates{" "}
              <span className="inline-block transition-transform group-hover:translate-x-1 motion-reduce:transform-none">
                -&gt;
              </span>
            </h2>
            <p className={`m-0 max-w-[30ch] text-sm opacity-50`}>
              Explore the Next.js 13 playground.
            </p>
          </a>

          <a
            href="https://vercel.com/new?utm_source=create-next-app&utm_medium=appdir-template&utm_campaign=create-next-app"
            className="group rounded-lg border border-transparent px-5 py-4 transition-colors hover:border-gray-300 hover:bg-gray-100 hover:dark:border-neutral-700 hover:dark:bg-neutral-800/30"
            target="_blank"
            rel="noopener noreferrer"
          >
            <h2 className={`mb-3 text-2xl font-semibold`}>
              Deploy{" "}
              <span className="inline-block transition-transform group-hover:translate-x-1 motion-reduce:transform-none">
                -&gt;
              </span>
            </h2>
            <p className={`m-0 max-w-[30ch] text-sm opacity-50`}>
              Instantly deploy your Next.js site to a shareable URL with Vercel.
            </p>
          </a>
        </div> */}
        <div id="siri-container"></div>
      </main>
      <ToastContainer />
    </>
  );
}
