"use client";
import { useState, useEffect, useRef } from "react";

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
      return;
    }
    if (!navigator.mediaDevices) {
      console.log("Cannot access microphone");
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
    <main className="mx-auto flex min-h-screen w-[80vw] min-w-[400px] flex-col items-center justify-center gap-4 overflow-visible py-8">
      {/* Textarea with recognized text */}
      <div className="relative w-full text-sm after:pointer-events-none after:absolute after:-z-20 after:h-[180px] after:w-[240px] after:translate-x-1/3 after:bg-gradient-conic after:from-sky-200 after:via-blue-200 after:blur-2xl after:content-[''] before:dark:bg-gradient-to-br before:dark:from-transparent before:dark:to-blue-700 before:dark:opacity-10 after:dark:from-sky-900 after:dark:via-[#0141ff] after:dark:opacity-40">
        <textarea
          ref={textareaRef}
          className="mx-auto flex max-h-[80vh] min-h-[240px] w-full justify-center rounded-xl border border-gray-200 bg-white bg-opacity-30 p-4 shadow-lg backdrop-blur-lg backdrop-filter dark:border-neutral-800 dark:bg-zinc-800/30 dark:from-inherit"
          placeholder="Recognized text"
          //   readOnly
        />

        {/* Fade upper part of textarea */}
        <div
          className={`pointer-events-none absolute inset-x-[1px] top-[1px] h-24 rounded-xl bg-gradient-to-b from-white dark:from-zinc-800/30 ${
            isTopFaded ? "opacity-100" : "opacity-0"
          } transition-opacity duration-300`}
        />
        <div
          className={`pointer-events-none absolute inset-x-[1px] bottom-[1px] h-24 rounded-xl bg-gradient-to-t from-white dark:from-zinc-800/30 ${
            isBottomFaded ? "opacity-100" : "opacity-0"
          } transition-opacity duration-300`}
        />
      </div>

      {/* Buttons */}
      <div className="flex w-full flex-row items-center justify-center gap-4">
        {/* Copy text button */}
        <button
          type="button"
          className="flex items-center justify-center rounded-md border border-gray-300 bg-gray-50 fill-gray-500 p-4 transition-colors hover:bg-gray-200 hover:from-inherit dark:border-neutral-800 dark:bg-zinc-800/30 dark:from-inherit dark:fill-gray-300 dark:hover:border-neutral-700 dark:hover:bg-zinc-500/30 lg:rounded-lg"
          onClick={() => handleCopy()}
        >
          <svg
            aria-hidden="true"
            height="16"
            width="16"
            viewBox="0 0 16 16"
            version="1.1"
            data-view-component="true"
          >
            <path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z" />
            <path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z" />
          </svg>
        </button>

        {/* Start record button with text "Start recording" */}
        <button
          type="button"
          className="flex justify-center rounded-lg bg-blue-500 p-[14px] text-sm text-gray-100 transition-colors hover:bg-blue-600 hover:from-inherit dark:from-inherit dark:invert"
          onClick={isRecording ? stopRecording : startRecording}
        >
          {isRecording ? "Stop recording" : "Start recording"}
        </button>

        {/* Clear text button */}
        <button
          type="button"
          className="flex items-center justify-center rounded-md border border-gray-300 bg-gray-50 fill-gray-500 p-4 transition-colors hover:bg-gray-200 hover:from-inherit dark:border-neutral-800 dark:bg-zinc-800/30 dark:from-inherit dark:fill-gray-300 dark:hover:border-neutral-700 dark:hover:bg-zinc-500/30 lg:rounded-lg"
          onClick={() => handleClear()}
        >
          <svg
            aria-hidden="true"
            height="16"
            width="16"
            viewBox="0 0 16 16"
            version="1.1"
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
      </div>
    </main>
  );
}
