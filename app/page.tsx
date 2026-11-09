import type { Metadata } from "next";
import GradingTool from "@/components/grading/GradingTool";

export const metadata: Metadata = {
  title: "TCG Grading Check",
  description: "Graded sold prices by company and grade, and whether grading a card pays.",
};

// Gated by proxy.ts: every price lookup spends Apify credit.
export default function GradingPage() {
  return <GradingTool />;
}
