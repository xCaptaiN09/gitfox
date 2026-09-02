"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GitHubApiError = exports.ModelResponseError = exports.OllamaError = exports.ConfigError = exports.GitfoxError = void 0;
class GitfoxError extends Error {
    constructor(message, options) {
        super(message, options);
        this.name = 'GitfoxError';
    }
}
exports.GitfoxError = GitfoxError;
class ConfigError extends GitfoxError {
    constructor(message, options) {
        super(message, options);
        this.name = 'ConfigError';
    }
}
exports.ConfigError = ConfigError;
class OllamaError extends GitfoxError {
    constructor(message, options) {
        super(message, options);
        this.name = 'OllamaError';
    }
}
exports.OllamaError = OllamaError;
class ModelResponseError extends GitfoxError {
    constructor(message, options) {
        super(message, options);
        this.name = 'ModelResponseError';
    }
}
exports.ModelResponseError = ModelResponseError;
class GitHubApiError extends GitfoxError {
    status;
    constructor(message, options) {
        super(message, options);
        this.name = 'GitHubApiError';
        this.status = options?.status;
    }
}
exports.GitHubApiError = GitHubApiError;
