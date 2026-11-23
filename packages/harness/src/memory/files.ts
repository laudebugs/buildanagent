/**
 * Where the memory folder's files are kept. The extension reaches them only through this interface, so it runs on any
 * target: `fileMemoryFiles()` in `@buildanagent/harness/memory/node` keeps them on disk, and a host on another runtime
 * passes a store of its own, such as a key-value namespace.
 */

/**
 * The files of one memory folder, by name relative to it, such as `project/build.md`. Every name the extension passes
 * has passed its path check. The extension also keeps its own bookkeeping here under names that start with a dot,
 * which the memory tool can never name.
 */
export interface MemoryFiles {
  /** Every regular file under the folder, by name, in any order. A missing folder has none. */
  list(): Promise<string[]>;
  /** The file's text, or `undefined` when there is no such file. */
  read(name: string): Promise<string | undefined>;
  /** Writes the file whole, making its folders, so a reader sees the old text or the new. */
  write(name: string, text: string): Promise<void>;
  /** Removes the file. A missing file is no error. */
  remove(name: string): Promise<void>;
  /** Moves a file to a name that is free. */
  rename(from: string, to: string): Promise<void>;
}
