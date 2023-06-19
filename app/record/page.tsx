"use client";

import { useState, useEffect, useRef } from "react";

const sampleRate = 16000;

export default function Home() {
  const [recognitionText, setRecognitionText] = useState<string[]>([]);
  const [serverIp, setServerIp] = useState<string>("");
  const [serverPort, setServerPort] = useState<string>("");
  const [results, setResults] = useState<string>("");
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [socket, setSocket] = useState<WebSocket | null>(null);

  // const [audioCtx, setAudioCtx] = useState<AudioContext | null>(null);
  // const [recordSampleRate, setRecordSampleRate] = useState<number>(0);
  // const [leftChannel, setLeftChannel] = useState<Int16Array[]>([]);
  // const [recordingLength, setRecordingLength] = useState<number>(0);

  const textArea = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (socket == null) return;

    // Connection opened
    socket.onopen = function () {
      console.log("connected");
      setIsRecording(true);
    };

    // Connection closed
    socket.onclose = function () {
      console.log("disconnected");
      setIsRecording(false);
    };

    // Listen for messages
    socket.onmessage = function (event) {
      let message = JSON.parse(event.data);
      if (message.segment in recognitionText) {
        recognitionText[message.segment] = message.text;
      } else {
        recognitionText.push(message.text);
      }
      textArea.current!.value = getDisplayResult();
      textArea.current!.scrollTop = textArea.current!.scrollHeight; // auto scroll

      console.log("Received message: ", event.data);
    };

    socket.onerror = function (event) {
      console.error("Socket error: ", event);
    };
  }, [socket]);

  useEffect(() => {
    if (isRecording) {
      startRecording();
    } else {
      stopRecording();
    }
  }, [isRecording]);

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
    setSocket(new WebSocket(uri));
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
    if (socket == null) return;
    if (!navigator.mediaDevices) {
      console.log("getUserMedia not supported on your browser!");
      return;
    }

    let leftchannel: Int16Array[] = [];
    let recordingLength = 0;

    const context = new AudioContext();
    const microphone = await navigator.mediaDevices.getUserMedia({
      audio: true,
    });

    const source = context.createMediaStreamSource(microphone);

    await context.audioWorklet.addModule("/worklet.js");

    const recorder = new AudioWorkletNode(context, "recorder.worklet");

    source.connect(recorder).connect(context.destination);

    recorder.port.onmessage = (event) => {
      let samples = event.data as Float32Array;
      console.log("samples: ", samples);
      samples = downsampleBuffer(samples, context.sampleRate);
      console.log("samples: ", samples);

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

    console.log("recorder started");
  }

  function stopRecording() {
    console.log("stop recording");
  }

  function handleStart() {
    initWebSocket();
  }

  function handleStop() {
    if (socket == null) return;

    console.log("recorder stopped");

    socket.send("Done");
    console.log("Sent Done");

    socket.close();
  }

  return (
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

      <div className="relative flex place-items-center before:pointer-events-none before:absolute before:h-[300px] before:w-[480px] before:-translate-x-1/2 before:rounded-full before:bg-gradient-radial before:from-white before:to-transparent before:blur-2xl before:content-[''] after:pointer-events-none after:absolute after:-z-20 after:h-[180px] after:w-[240px] after:translate-x-1/3 after:bg-gradient-conic after:from-sky-200 after:via-blue-200 after:blur-2xl after:content-[''] before:dark:bg-gradient-to-br before:dark:from-transparent before:dark:to-blue-700 before:dark:opacity-10 after:dark:from-sky-900 after:dark:via-[#0141ff] after:dark:opacity-40 before:lg:h-[360px]">
        <h3 className="relative text-center text-3xl font-bold text-gray-900 dark:drop-shadow-[0_0_0.3rem_#ffffff70] dark:invert">
          Recognition from
          <br />
          real-time recordings
        </h3>
      </div>

      {/* Textarea with recognized text */}
      <div className="relative w-full max-w-5xl text-sm">
        <textarea
          ref={textArea}
          className="flex min-h-[20vh] w-full justify-center border-y border-gray-300 bg-white/30 p-4 backdrop-blur-2xl dark:border-neutral-800 dark:bg-zinc-800/30 dark:from-inherit lg:rounded-xl lg:border"
          placeholder="Recognized text"
          value={results}
          onChange={(e) => setResults(e.target.value)}
        />

        {/* Copy text button */}
        <button
          type="button"
          className="absolute right-0 top-0 m-4 flex h-10 w-10 items-center justify-center rounded-md bg-white fill-gray-500 p-3 transition-colors hover:bg-gray-200 hover:from-inherit dark:bg-zinc-800/30 dark:from-inherit dark:fill-gray-300 dark:hover:bg-zinc-500/30 lg:rounded-lg"
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

        {/* Start record button with text "Start recording" */}
        <button
          type="button"
          className="absolute bottom-0 right-0 m-4 flex justify-center rounded-md bg-blue-500 p-4 text-gray-100 transition-colors hover:bg-blue-600 hover:from-inherit dark:from-inherit dark:invert lg:rounded-lg"
          onClick={isRecording ? handleStop : handleStart}
        >
          {isRecording ? "Stop recording" : "Start recording"}
        </button>
      </div>

      <div className="mb-0 grid text-center lg:grid-cols-4 lg:text-left">
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
      </div>
    </main>
  );
}
