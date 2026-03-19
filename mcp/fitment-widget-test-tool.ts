import { z } from "zod"
import { runFitmentSanityCheckMcpTool } from "@/mcp/fitment-sanity-check-tool"

export const FitmentWidgetTestInputSchema = {
  query: z.string().min(1).max(400).describe("Fitment question to run through the real fitment logic but return with widget-first narration for ChatGPT testing."),
}

export const FitmentWidgetTestOutputSchema = {
  query: z.string(),
  reply: z.string(),
  verdict: z.string(),
  ui: z.any(),
}

export async function runFitmentWidgetTestTool(args: { query: string }) {
  return await runFitmentSanityCheckMcpTool(args)
}
