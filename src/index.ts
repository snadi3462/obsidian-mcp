import { createMcpExpressApp } from "@modelcontextprotocol/express";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import fs from "node:fs/promises";
import path from "node:path";

const app = createMcpExpressApp({
  host: "0.0.0.0",
});

// Use the environment variable locally if available.
// On Render, fall back to the deployed project directory.
const VAULT_PATH =
  process.env.OBSIDIAN_VAULT_PATH || path.resolve(process.cwd());

const handler = createMcpHandler(() => {
  const server = new McpServer({
    name: "obsidian-mcp",
    version: "1.0.0",
  });

  // ============================================================
  // Tool 1: Get server status
  // ============================================================

  server.registerTool(
    "get_server_status",
    {
      description: "Check whether the Obsidian MCP server is running",
      inputSchema: z.object({}),
    },
    async () => ({
      content: [
        {
          type: "text",
          text: "Obsidian MCP server is online!",
        },
      ],
    })
  );

  // ============================================================
  // Tool 2: List notes
  // ============================================================

  server.registerTool(
    "list_notes",
    {
      description: "List Markdown notes in the Obsidian vault",
      inputSchema: z.object({}),
    },
    async () => {
      const notes: string[] = [];

      async function scanDirectory(directory: string): Promise<void> {
        const entries = await fs.readdir(directory, {
          withFileTypes: true,
        });

        for (const entry of entries) {
          // Ignore Obsidian configuration
          if (entry.name === ".obsidian") {
            continue;
          }

          const fullPath = path.join(directory, entry.name);

          if (entry.isDirectory()) {
            await scanDirectory(fullPath);
          } else if (
            entry.isFile() &&
            entry.name.toLowerCase().endsWith(".md")
          ) {
            notes.push(path.relative(VAULT_PATH, fullPath));
          }
        }
      }

      await scanDirectory(VAULT_PATH);

      notes.sort();

      return {
        content: [
          {
            type: "text",
            text:
              notes.length > 0
                ? notes.join("\n")
                : "No Markdown notes found in the vault.",
          },
        ],
      };
    }
  );

  // ============================================================
  // Tool 3: Read a note
  // ============================================================

  server.registerTool(
    "read_note",
    {
      description:
        "Read the contents of a Markdown note in the Obsidian vault",
      inputSchema: z.object({
        notePath: z
          .string()
          .min(1)
          .describe("Relative path of the note inside the vault"),
      }),
    },
    async ({ notePath }) => {
      const vaultRoot = path.resolve(VAULT_PATH);
      const fullPath = path.resolve(vaultRoot, notePath);

      // Prevent access outside the vault
      if (
        fullPath !== vaultRoot &&
        !fullPath.startsWith(vaultRoot + path.sep)
      ) {
        return {
          content: [
            {
              type: "text",
              text: "Error: Access outside the Obsidian vault is not allowed.",
            },
          ],
          isError: true,
        };
      }

      // Only allow Markdown files
      if (!fullPath.toLowerCase().endsWith(".md")) {
        return {
          content: [
            {
              type: "text",
              text: "Error: Only Markdown (.md) notes can be read.",
            },
          ],
          isError: true,
        };
      }

      try {
        const content = await fs.readFile(fullPath, "utf8");

        return {
          content: [
            {
              type: "text",
              text: content,
            },
          ],
        };
      } catch {
        return {
          content: [
            {
              type: "text",
              text: `Error: Note not found: ${notePath}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ============================================================
  // Tool 4: Search notes
  // ============================================================

  server.registerTool(
    "search_notes",
    {
      description:
        "Search for text inside Markdown notes in the Obsidian vault",
      inputSchema: z.object({
        query: z
          .string()
          .min(1)
          .describe("Text or phrase to search for inside the notes"),
      }),
    },
    async ({ query }) => {
      const results: string[] = [];
      const searchQuery = query.toLowerCase();

      async function scanDirectory(directory: string): Promise<void> {
        const entries = await fs.readdir(directory, {
          withFileTypes: true,
        });

        for (const entry of entries) {
          // Ignore Obsidian configuration
          if (entry.name === ".obsidian") {
            continue;
          }

          const fullPath = path.join(directory, entry.name);

          if (entry.isDirectory()) {
            await scanDirectory(fullPath);
          } else if (
            entry.isFile() &&
            entry.name.toLowerCase().endsWith(".md")
          ) {
            try {
              const content = await fs.readFile(fullPath, "utf8");

              if (content.toLowerCase().includes(searchQuery)) {
                const relativePath = path.relative(
                  VAULT_PATH,
                  fullPath
                );

                results.push(relativePath);
              }
            } catch {
              // Ignore files that cannot be read
            }
          }
        }
      }

      await scanDirectory(VAULT_PATH);

      results.sort();

      return {
        content: [
          {
            type: "text",
            text:
              results.length > 0
                ? results.join("\n")
                : `No notes found containing: ${query}`,
          },
        ],
      };
    }
  );

  return server;
});

// ============================================================
// MCP HTTP handler
// ============================================================

const nodeHandler = toNodeHandler(handler);

app.all("/mcp", (req, res) => {
  void nodeHandler(req, res, req.body);
});

// ============================================================
// Health check
// ============================================================

app.get("/", (_req, res) => {
  res.status(200).send("Obsidian MCP server is running!");
});

// ============================================================
// Start server
// ============================================================

const PORT = Number(process.env.PORT) || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Obsidian MCP server running on port ${PORT}`);
});