import { open, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { relative, extname, resolve, isAbsolute, win32 } from 'node:path';
import * as ts from 'typescript';

import { DEFAULT_SOURCE_LIMITS, discoverSourceFiles, type SourceLimits } from './source.js';
import type { LanguageRegistry } from './languages/registry.js';

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
export interface SymbolUsage { filePath: string; line: number; column: number; preview: string; start: number; end: number; }
export interface UsageResult { symbol: SourceSymbol; usages: SymbolUsage[]; truncated: boolean; scope: { filesProcessed: number; filesDiscovered: number; warnings: string[] }; }
export type DefinitionResult = { outcome: 'resolved'; definition: SourceSymbol; method: 'typescript-checker'; warnings: string[] } | { outcome: 'unresolved' | 'ambiguous' | 'unsupported'; message: string; warnings: string[] };

/** Parses a bounded, safe source scope without executing repository code. */
export async function listRepositorySymbols(repositoryPath: string, limits: SourceLimits = DEFAULT_SOURCE_LIMITS, registry?: LanguageRegistry): Promise<SymbolResult> {
  const files = await discoverSourceFiles(repositoryPath, limits.maxFiles + 1, registry);
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

/** Finds AST identifier name occurrences only; these are deliberately not type-resolved references. */
export async function findPossibleUsages(repositoryPath: string, selected: Pick<SourceSymbol, 'filePath' | 'name' | 'kind' | 'startLine'>, limits: SourceLimits = DEFAULT_SOURCE_LIMITS, registry?: LanguageRegistry): Promise<UsageResult> {
  const declarationScan = await listRepositorySymbols(repositoryPath, limits, registry);
  const symbol = declarationScan.symbols.find(item => item.filePath === selected.filePath && item.name === selected.name && item.kind === selected.kind && item.startLine === selected.startLine);
  if (!symbol) throw new Error('The selected declaration no longer exists in this repository.');
  const files = await discoverSourceFiles(repositoryPath, limits.maxFiles + 1, registry); const warnings = [...declarationScan.scope.warnings]; const filesDiscovered = files.length;
  if (files.length > limits.maxFiles) files.length = limits.maxFiles;
  const usages: SymbolUsage[] = []; let filesProcessed = 0; let totalBytes = 0; let truncated = false;
  for (const absolutePath of files) {
    const filePath = relative(repositoryPath, absolutePath); let size: number;
    try { size = (await stat(absolutePath)).size; } catch { warnings.push(`Skipped ${filePath}: file became unavailable during scanning.`); continue; }
    if (size > limits.maxFileBytes) { warnings.push(`Skipped ${filePath}: exceeds ${limits.maxFileBytes} bytes.`); continue; }
    if (totalBytes + size > limits.maxTotalBytes) { warnings.push(`Source byte limit reached (${limits.maxTotalBytes}); remaining files were not processed.`); break; }
    let text: string; try { text = await readBounded(absolutePath, limits.maxFileBytes); } catch { warnings.push(`Skipped ${filePath}: file became unavailable during scanning.`); continue; }
    const bytes = Buffer.byteLength(text);
    if (bytes > limits.maxFileBytes || totalBytes + bytes > limits.maxTotalBytes) {
      warnings.push(`Skipped ${filePath}: source byte limit exceeded during scanning.`);
      continue;
    }
    totalBytes += bytes;
    filesProcessed += 1;
    const sf = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, scriptKind(filePath));
    const sourceLines = text.split(/\r?\n/);
    // Find the declaration once per file, not once per matching identifier.
    const declarationPosition = filePath === symbol.filePath ? declarationNamePosition(sf, symbol) : -1;
    const visit = (node: ts.Node): void => {
      if (truncated) return;
      if (ts.isIdentifier(node) && node.text === symbol.name) {
        const offset = node.getStart(sf);
        if (offset !== declarationPosition) {
          const pos = sf.getLineAndCharacterOfPosition(offset);
          const sourceLine = sourceLines[pos.line] ?? '';
          // Keep the match visible even when the identifier is far into a long line.
          const windowStart = Math.max(0, pos.character - 120);
          const preview = sourceLine.slice(windowStart, windowStart + 320);
          usages.push({
            filePath, line: pos.line + 1, column: pos.character + 1, preview,
            start: pos.character - windowStart, end: pos.character - windowStart + node.text.length,
          });
          if (usages.length >= 200) { truncated = true; return; }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf); if (truncated) break;
  }
  if (truncated) warnings.push('Usage limit reached (200); results are truncated.');
  usages.sort((a, b) => a.filePath.localeCompare(b.filePath) || a.line - b.line || a.column - b.column);
  return { symbol, usages, truncated, scope: { filesProcessed, filesDiscovered, warnings } };
}
function declarationNamePosition(sf: ts.SourceFile, symbol: SourceSymbol): number { let position = -1; const visit = (node: ts.Node) => { if (position >= 0) return; if (ts.isIdentifier(node) && node.text === symbol.name && sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1 === symbol.startLine) position = node.getStart(sf); else ts.forEachChild(node, visit); }; visit(sf); return position; }

/** Resolves only compiler-proven local bindings from a bounded in-memory source graph. */
export async function resolveDefinition(repositoryPath: string, request: { filePath: string; line: number; column: number }, limits: SourceLimits = DEFAULT_SOURCE_LIMITS, registry?: LanguageRegistry): Promise<DefinitionResult> {
  if (!request.filePath || request.filePath.includes('\\') || isAbsolute(request.filePath) || win32.isAbsolute(request.filePath) || request.filePath.split('/').some(p => !p || p === '.' || p === '..') || request.line < 1 || request.column < 1 || !Number.isInteger(request.line) || !Number.isInteger(request.column)) return { outcome: 'unsupported', message: 'A valid repository-relative identifier position is required.', warnings: [] };
  const files = await discoverSourceFiles(repositoryPath, limits.maxFiles + 1, registry); const warnings: string[] = []; let total = 0; const texts = new Map<string, string>();
  if (files.length > limits.maxFiles) { warnings.push(`File limit reached (${limits.maxFiles}); some supported files were not processed.`); files.length = limits.maxFiles; }
  for (const path of files) { try { const size = (await stat(path)).size; if (size > limits.maxFileBytes || total + size > limits.maxTotalBytes) { warnings.push(`Skipped ${relative(repositoryPath, path)} due to source limits.`); continue; } const text = await readBounded(path, limits.maxFileBytes); const bytes = Buffer.byteLength(text); if (bytes > limits.maxFileBytes || total + bytes > limits.maxTotalBytes) { warnings.push(`Skipped ${relative(repositoryPath, path)} due to source limits after reading.`); continue; } total += bytes; texts.set(resolve(path), text); } catch { warnings.push(`Skipped ${relative(repositoryPath, path)}: unavailable.`); } }
  const root = resolve(repositoryPath); const target = resolve(root, request.filePath); if (relative(root, target).startsWith('..')) return { outcome: 'unsupported', message: 'The selected source file is outside the repository.', warnings }; const text = texts.get(target); if (!text) return { outcome: 'unsupported', message: 'The selected source file is outside the available repository scope.', warnings };
  const options: ts.CompilerOptions = { allowJs: true, checkJs: true, noLib: true, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Node10, jsx: ts.JsxEmit.Preserve };
  const host: ts.CompilerHost = { fileExists: f => texts.has(resolve(f)), readFile: f => texts.get(resolve(f)), getSourceFile: (f, lang) => { const value = texts.get(resolve(f)); return value === undefined ? undefined : ts.createSourceFile(resolve(f), value, lang, true, scriptKind(f)); }, getDefaultLibFileName: () => '', writeFile: () => undefined, getCurrentDirectory: () => resolve(repositoryPath), getDirectories: () => [], getCanonicalFileName: f => f, useCaseSensitiveFileNames: () => true, getNewLine: () => '\n' };
  const program = ts.createProgram({ rootNames: [...texts.keys()], options, host }); const sf = program.getSourceFile(target); if (!sf) return { outcome: 'unresolved', message: 'The selected source file is unavailable.', warnings };
  const lines = text.split(/\r?\n/); if (request.line > lines.length || request.column > (lines[request.line - 1]?.length ?? 0) + 1) return { outcome: 'unsupported', message: 'The selected position is outside the current source file.', warnings };
  const lineStart = sf.getPositionOfLineAndCharacter(request.line - 1, request.column - 1); let found: ts.Identifier | undefined;
  const visit = (node: ts.Node): void => { if (found) return; if (ts.isIdentifier(node) && lineStart >= node.getStart(sf) && lineStart < node.getEnd()) found = node; else ts.forEachChild(node, visit); }; visit(sf);
  if (!found) return { outcome: 'unsupported', message: 'No identifier exists at the selected position.', warnings };
  const checker = program.getTypeChecker(); let symbol = checker.getSymbolAtLocation(found); if (!symbol) return { outcome: 'unresolved', message: 'No local declaration could be proven for this identifier.', warnings };
  if (symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
  const declarations = symbol.getDeclarations()?.filter(d => texts.has(resolve(d.getSourceFile().fileName))) ?? [];
  if (declarations.length !== 1) return { outcome: declarations.length > 1 ? 'ambiguous' : 'unresolved', message: 'The declaration is not uniquely available in the prepared source scope.', warnings };
  const declaration = declarations[0]!; const named = (declaration as ts.NamedDeclaration).name; const nameNode: ts.Node = named !== undefined && ts.isIdentifier(named) ? named : declaration; const declarationFile = declaration.getSourceFile(); const start = declarationFile.getLineAndCharacterOfPosition(nameNode.getStart(declarationFile)); const end = declarationFile.getLineAndCharacterOfPosition(declaration.getEnd());
  const kind: SymbolKind = ts.isClassDeclaration(declaration) ? 'class' : ts.isFunctionDeclaration(declaration) ? 'function' : ts.isVariableDeclaration(declaration) ? 'variable' : ts.isMethodDeclaration(declaration) ? 'method' : 'variable';
  return { outcome: 'resolved', definition: { filePath: relative(repositoryPath, declarationFile.fileName), name: symbol.getName(), kind, startLine: start.line + 1, endLine: Math.max(start.line + 1, end.line + 1) }, method: 'typescript-checker', warnings };
}
