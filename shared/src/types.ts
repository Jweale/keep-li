export type Intent = "learn" | "post_idea" | "outreach" | "research";

export interface SummarizeInput {
  url: string;
  title?: string;
  highlight?: string;
  licenseKey?: string;
}

export interface SummarizeOutput {
  summary_160: string;
  tags: string[];
  intent: Intent;
  next_action: string;
  tokens_in: number;
  tokens_out: number;
}

export interface SheetRowInput {
  date_added: string;
  source: "linkedin" | "web";
  url: string;
  title: string;
  highlight?: string;
  summary_160?: string;
  tags?: string[];
  intent?: Intent;
  next_action?: string;
  status: "inbox" | "to_use" | "archived";
  url_hash: string;
  notes?: string;
}
