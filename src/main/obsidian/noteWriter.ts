import fs from 'fs';
import path from 'path';
import { BrowserWindow } from 'electron';

/**
 * NoteWriter saves generated Markdown notes to the user's
 * configured Obsidian vault directory.
 * 
 * Features:
 * - Writes .md files to the vault path
 * - Generates filename with date pattern: "Reunião YYYY-MM-DD HH-mm.md"
 * - Avoids overwriting existing files by appending a counter
 * - Notifies the renderer when a note is saved
 */
export class NoteWriter {
  private vaultPath: string;

  constructor(vaultPath: string) {
    this.vaultPath = vaultPath;
  }

  /**
   * Write a Markdown note to the Obsidian vault.
   * 
   * @param markdown - The complete markdown content to write
   * @returns The absolute path to the saved file
   * @throws Error if vault path is invalid or write fails
   */
  async write(markdown: string): Promise<string> {
    // Validate vault path
    if (!this.vaultPath) {
      throw new Error('Obsidian vault path not configured');
    }

    // Normalize and resolve path
    const vaultDir = path.resolve(this.vaultPath);

    // Ensure directory exists
    if (!fs.existsSync(vaultDir)) {
      throw new Error(
        `Obsidian vault directory does not exist: ${vaultDir}`
      );
    }

    // Generate filename
    const now = new Date();
    const datePart = this.formatDateForFile(now);
    const baseName = `Reunião ${datePart}`;
    const filePath = this.getUniqueFilePath(vaultDir, baseName);

    // Write the file
    fs.writeFileSync(filePath, markdown, 'utf-8');

    console.log(`[NoteWriter] Note saved: ${filePath}`);

    // Notify renderers
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send('obsidian:note-saved', {
          filePath,
          note: { title: baseName },
        });
      }
    });

    return filePath;
  }

  /**
   * Atualiza uma nota criada por esta instância após a análise final.
   */
  async update(filePath: string, markdown: string): Promise<void> {
    const vaultDir = path.resolve(this.vaultPath);
    const resolvedFile = path.resolve(filePath);
    const relative = path.relative(vaultDir, resolvedFile);

    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('Refusing to update a note outside the configured Obsidian vault');
    }
    if (!fs.existsSync(resolvedFile)) {
      throw new Error(`Obsidian note does not exist: ${resolvedFile}`);
    }

    fs.writeFileSync(resolvedFile, markdown, 'utf-8');
    console.log(`[NoteWriter] Note updated with final analysis: ${resolvedFile}`);
  }

  /**
   * Generate a filename with date and optional counter
   * to avoid overwriting existing files.
   */
  private getUniqueFilePath(dir: string, baseName: string): string {
    const base = path.join(dir, baseName);
    const ext = '.md';

    // Check if file exists
    if (!fs.existsSync(`${base}${ext}`)) {
      return `${base}${ext}`;
    }

    // Append counter
    let counter = 1;
    while (fs.existsSync(`${base} (${counter})${ext}`)) {
      counter++;
    }
    return `${base} (${counter})${ext}`;
  }

  private formatDateForFile(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const h = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${d} ${h}-${min}`;
  }
}
