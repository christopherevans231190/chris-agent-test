import {
  type JobContext,
  type JobProcess,
  ServerOptions,
  cli,
  defineAgent,
  inference,
  metrics,
  voice,
} from "@livekit/agents";

import * as anam from "@livekit/agents-plugin-anam";
import * as livekit from "@livekit/agents-plugin-livekit";
import * as silero from "@livekit/agents-plugin-silero";
import * as deepgram from "@livekit/agents-plugin-deepgram";
import * as cartesia from "@livekit/agents-plugin-cartesia";

import { BackgroundVoiceCancellation } from "@livekit/noise-cancellation-node";

import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { Agent } from "./agent";

dotenv.config({ path: ".env.local" });

export default defineAgent({
  prewarm: async (proc: JobProcess) => {
    proc.userData.vad = await silero.VAD.load();
  },

  entry: async (ctx: JobContext) => {
    const session = new voice.AgentSession({
      stt: new deepgram.STT({
        model: "nova-3",
        language: "fr",
        interim_results: true,
        punctuate: true,
        smart_format: true,
        endpointing_ms: 120,
      }),

      llm: new inference.LLM({
        model: "openai/gpt-4o-mini",
        temperature: 0.2,
      }),

      tts: new cartesia.TTS({
        voice: "0418348a-0ca2-4e90-9986-800fb8b3bbc0",
        language: "fr",
      }),

      turnDetection: new livekit.turnDetector.MultilingualModel({
        minSilenceDurationMs: 120,
      }),

      vad: ctx.proc.userData.vad as silero.VAD,

      vadOptions: {
        prefixPaddingMs: 80,
        silenceDurationMs: 120,
      },

      voiceOptions: {
        preemptiveGeneration: true,
      },
    });

    const avatar = new anam.AvatarSession({
      personaConfig: {
        name: "Julien",
        avatarId: "6cc28442-cccd-42a8-b6e4-24b7210a09c5",
      },
    });

    const usageCollector = new metrics.UsageCollector();

    session.on(voice.AgentSessionEventTypes.MetricsCollected, (ev) => {
      metrics.logMetrics(ev.metrics);
      usageCollector.collect(ev.metrics);

      console.log("----- LATENCY -----");
      console.log("TOTAL:", ev.metrics.endOfUtteranceDelayMs);
    });

    const logUsage = async () => {
      const summary = usageCollector.getSummary();
      console.log(`Usage: ${JSON.stringify(summary)}`);
    };

    ctx.addShutdownCallback(logUsage);

    await ctx.connect();

    await session.start({
      agent: new Agent(),
      room: ctx.room,
      inputOptions: {
        noiseCancellation: BackgroundVoiceCancellation(),
        closeOnDisconnect: false,
      },
    });

    await avatar.start(session, ctx.room);

    session.generateReply({
      instructions: "Dis bonjour en français en une seule phrase courte et naturelle.",
    });
  },
});

cli.runApp(
  new ServerOptions({
    agent: fileURLToPath(import.meta.url),
    agentName: "my-agent",
  })
);