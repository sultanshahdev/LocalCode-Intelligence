import { open, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { relative, extname } from 'node:path';
import * as ts from 'typescript';

import { DEFAULT_SOURCE_LIMITS, discoverSourceFiles, type SourceLimits } from './source.js';

export const SYMBOL_LIMITS = { maxSymbols: 1_000 } as const;
export type SymbolKind = 'function' | 'class' | 'method' | 'interface' | 'type alias' | 'enum' | 'variable';
export interface SourceSymbol {
  filePath: string; name: string; kind: SymbolKind; startLine: number; endLine: number;
  containerName?: string; exported?: boolean;
}
export interface SymbolResult {
  symbols: SourceSymbol[]; truncated: boolean;
  scope: { filesProcessed: number; filesDiscovered: number; warnings: string[] };
}

/** Parses a bounded, safe source scope without executing repository code. */
export async function listRepositorySymbols(repositoryPath: string, limits: SourceLimits = DEFAULT_SOURCE_LIMITS): Promise<SymbolResult> {
  const files = await discoverSourceFiles(repositoryPath, limits.maxFiles + 1);
  const warnings: string[] = [];
  const filesDiscovered = files.length;
  if (files.length > limits.maxFiles) { warnings.push(`File limit reached (${limits.maxFiles}); some supported files were not processed.`); files.length = limits.maxFiles; }
  const symbols: SourceSymbol[] = [];
  let filesProcessed = 0;
  let totalBytes = 0;
  let truncated = false;
  for (const absolutePath of files) {
    const filePath = relative(repositoryPath, absolutePath);
    let expectedBytes: number;
    try { expectedBytes = (await stat(absolutePath)).size; } catch { warnings.push(`Skipped ${filePath}: file became unavailable during scanning.`); continue; }
    if (expectedBytes > limits.maxFileBytes) { warnings.push(`Skipped ${filePath}: exceeds ${limits.maxFileBytes} bytes.`); continue; }
    if (totalBytes + expectedBytes > limits.maxTotalBytes) { warnings.push(`Source byte limit reached (${limits.maxTotalBytes}); remaining files were not processed.`); break; }
    let source: string;
    try { source = await readBounded(absolutePath, limits.maxFileBytes); } catch { warnings.push(`Skipped ${filePath}: file became unavailable during scanning.`); continue; }
    const bytes = Buffer.byteLength(source);
    if (bytes > limits.maxFileBytes) { warnings.push(`Skipped ${filePath}: exceeds ${limits.maxFileBytes} bytes.`); continue; }
    if (totalBytes + bytes > limits.maxTotalBytes) { warnings.push(`Source byte limit reached (${limits.maxTotalBytes}); remaining files were not processed.`); break; }
    totalBytes += bytes; filesProcessed += 1;
    const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, scriptKind(filePath));
    const diagnostics = ts.transpileModule(source, { reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.Latest }, fileName: filePath }).diagnostics ?? [];
    if (diagnostics.length > 0) warnings.push(`Parsed ${filePath} with ${diagnostics.length} syntax error${diagnostics.length === 1 ? '' : 's'}; available declarations may be incomplete.`);
    extractSymbols(sourceFile, filePath, symbols);
    if (symbols.length >= SYMBOL_LIMITS.maxSymbols) { symbols.length = SYMBOL_LIMITS.maxSymbols; truncated = true; break; }
  }
  if (truncated) warnings.push(`Symbol limit reached (${SYMBOL_LIMITS.maxSymbols}); refine the repository scope to see additional declarations.`);
  return { symbols, truncated, scope: { filesProcessed, filesDiscovered, warnings } };
}

function extractSymbols(sourceFile: ts.SourceFile, filePath: string, output: SourceSymbol[]): void {
  const add = (node: ts.Node, name: string, kind: SymbolKind, containerName?: string, exported?: boolean) => {
    if (!name || output.length >= SYMBOL_LIMITS.maxSymbols) return;
    const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
    const symbol: SourceSymbol = { filePath, name, kind, startLine: start.line + 1, endLine: Math.max(start.line + 1, end.line + 1) };
    if (containerName !== undefined) symbol.containerName = containerName;
    if (exported !== undefined) symbol.exported = exported;
    output.push(symbol);
  };
  const isExported = (node: ts.Node) => (ts.getCombinedModifierFlags(node as ts.Declaration) & (ts.ModifierFlags.Export | ts.ModifierFlags.Default)) !== 0;
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) add(statement, statement.name.text, 'function', undefined, isExported(statement));
    else if (ts.isClassDeclaration(statement) && statement.name) {
      add(statement, statement.name.text, 'class', undefined, isExported(statement));
      extractMembers(statement.members, statement.name.text, sourceFile, add);
    } else if (ts.isInterfaceDeclaration(statement)) {
      add(statement, statement.name.text, 'interface', undefined, isExported(statement));
      extractMembers(statement.members, statement.name.text, sourceFile, add);
    } else if (ts.isTypeAliasDeclaration(statement)) add(statement, statement.name.text, 'type alias', undefined, isExported(statement));
    else if (ts.isEnumDeclaration(statement)) add(statement, statement.name.text, 'enum', undefined, isExported(statement));
    else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.initializer && (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer))) add(declaration, declaration.name.text, 'variable', undefined, isExported(statement));
      }
    }
  }
}

function extractMembers(members: ts.NodeArray<ts.ClassElement | ts.TypeElement>, container: string, sourceFile: ts.SourceFile, add: (node: ts.Node, name: string, kind: SymbolKind, containerName?: string) => void): void {
  for (const member of members) {
    if ((ts.isMethodDeclaration(member) || ts.isMethodSignature(member)) && member.name) {
      const name = propertyName(member.name); if (name) add(member, name, 'method', container);
    }
  }
}
function propertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return undefined;
}
function scriptKind(path: string): ts.ScriptKind {
  switch (extname(path).toLowerCase()) {
    case '.tsx': return ts.ScriptKind.TSX; case '.jsx': return ts.ScriptKind.JSX;
    case '.js': case '.mjs': case '.cjs': return ts.ScriptKind.JS;
    default: return ts.ScriptKind.TS;
  }
}
async function readBounded(path: string, maxBytes: number): Promise<string> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { const buffer = Buffer.alloc(maxBytes + 1); let count = 0; while (count < buffer.length) { const { bytesRead } = await handle.read(buffer, count, buffer.length - count, count); if (bytesRead === 0) break; count += bytesRead; } return buffer.subarray(0, count).toString('utf8'); }
  finally { await handle.close(); }
}
