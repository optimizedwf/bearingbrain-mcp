import { z } from "zod"
import { runRecommendBuyOptionMcpTool } from "@/mcp/recommend-buy-option-tool"

export const RecommendBuyOptionWidgetTestInputSchema = {
  query: z.string().min(1).max(400).describe("Shopping question to run through the real recommendation logic but return with widget-first narration for ChatGPT testing."),
}

export const RecommendBuyOptionWidgetTestOutputSchema = {
  query: z.string(),
  reply: z.string(),
  ui: z.any(),
}

export async function runRecommendBuyOptionWidgetTestTool(args: { query: string }) {
  return await runRecommendBuyOptionMcpTool(args)
}
