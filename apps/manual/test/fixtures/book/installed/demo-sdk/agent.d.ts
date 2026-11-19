// The entry re-exports only createAgent from here, so internalHelper is no export of the package.
export interface AgentOptions {
  readonly name: string;
  readonly maxTurns?: number;
}
export interface RunResult {
  readonly text: string;
}
export interface Agent {
  run(prompt: string): Promise<RunResult>;
}
export declare function createAgent(options: AgentOptions): Agent;
export declare function internalHelper(): void;
