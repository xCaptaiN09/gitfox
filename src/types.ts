export type Severity = 'critical' | 'warning' | 'suggestion';

export interface DiffFile {
  path: string;
  patch: string | null;
}

export interface PullRequestContext {
  number: number;
  title: string;
  body: string;
  author: string;
  diff: string;
  files: DiffFile[];
}

export interface IssueContext {
  number: number;
  title: string;
  body: string;
  author: string;
  labels: string[];
}

export interface Finding {
  severity: Severity;
  file: string;
  line?: number;
  comment: string;
  suggestion?: string;
}

export interface ReviewResult {
  summary: string;
  findings: Finding[];
}

export interface TriageResult {
  labels: string[];
  comment: string;
}

export interface PriorFix {
  number: number;
  title: string;
  url: string;
}

export interface GitfoxConfig {
  token: string;
  model: string;
  rulesPath: string;
  rulesContent: string;
  scanAll: boolean;
  maxScanItems: number;
  maxComments: number;
  ollamaUrl: string;
  postSuggestions: boolean;
  searchFixed: boolean;
}
