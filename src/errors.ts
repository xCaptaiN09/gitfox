export class GitfoxError extends Error {
  public constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'GitfoxError';
  }
}

export class ConfigError extends GitfoxError {
  public constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ConfigError';
  }
}

export class OllamaError extends GitfoxError {
  public constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'OllamaError';
  }
}

export class ModelResponseError extends GitfoxError {
  public constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ModelResponseError';
  }
}

export class GitHubApiError extends GitfoxError {
  public readonly status?: number;

  public constructor(message: string, options?: { cause?: unknown; status?: number }) {
    super(message, options);
    this.name = 'GitHubApiError';
    this.status = options?.status;
  }
}
