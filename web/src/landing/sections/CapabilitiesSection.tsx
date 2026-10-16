import React, { useEffect, useState } from 'react';
import { Search, TextCursorInput, Code2, Network, FileSearch, Globe2, ShieldCheck } from 'lucide-react';
import { apiLanguages, type LanguageAdapterInfo } from '../../api';

export function CapabilitiesSection() {
  const [languages, setLanguages] = useState<LanguageAdapterInfo[]>([]);
  const [langCount, setLangCount] = useState<number>(11);

  useEffect(() => {
    let cancelled = false;
    apiLanguages()
      .then((res) => {
        if (!cancelled && res.languages) {
          setLanguages(res.languages);
          setLangCount(res.languages.length);
        }
      })
      .catch(() => {
        // Fallback silently if offline or backend route not ready
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const capabilities = [
    {
      icon: <Search size={22} className="cap-icon cap-icon--purple" />,
      title: 'Semantic Code Search',
      description: 'Find relevant source logic using natural-language behavioral queries, backed by local vector embeddings and cosine similarity ranking.',
    },
    {
      icon: <TextCursorInput size={22} className="cap-icon cap-icon--lavender" />,
      title: 'Exact Text Search',
      description: 'Scan source text for exact identifiers, strings, regex patterns, and error messages with case-sensitive and whole-word options.',
    },
    {
      icon: <Code2 size={22} className="cap-icon cap-icon--purple" />,
      title: 'Symbol Explorer',
      description: 'Extract functions, classes, interfaces, and nested methods directly from source ASTs with coordinates and possible name usage inspection.',
    },
    {
      icon: <Network size={22} className="cap-icon cap-icon--lavender" />,
      title: '2D Repository Map',
      description: 'Interactive visualization of directory structures, file distributions, and hierarchical paths with pan, zoom, and instant node inspection.',
    },
    {
      icon: <FileSearch size={22} className="cap-icon cap-icon--purple" />,
      title: 'Source Inspector',
      description: 'Dedicated right-side source viewer displaying line-accurate code, surrounding context, copy shortcuts, and GitHub reference links.',
    },
    {
      icon: <Globe2 size={22} className="cap-icon cap-icon--lavender" />,
      title: `Multilingual Intelligence (${langCount} Languages)`,
      description: `Built-in AST parser adapters supporting ${languages.length > 0 ? languages.map(l => l.name).slice(0, 6).join(', ') + ' and more' : 'JavaScript/TypeScript, Python, Go, Rust, Java, C/C++, C#, Ruby, PHP, and Bash'}.`,
    },
    {
      icon: <ShieldCheck size={22} className="cap-icon cap-icon--purple" />,
      title: 'Local-First Architecture',
      description: 'All embedding inference, tree-sitter parsing, and exact text scanning execute entirely on your machine. No telemetry or code sent to cloud LLMs.',
    },
  ];

  return (
    <section id="capabilities" className="landing-capabilities-section">
      <div className="landing-section-header">
        <span className="section-pre-title">Core Capabilities</span>
        <h2 className="section-main-title">Built for code comprehension</h2>
        <p className="section-sub-title">
          Every tool you need to understand an unfamiliar codebase without guesswork or synthetic hallucinations.
        </p>
      </div>

      <div className="capabilities-grid">
        {capabilities.map((cap, idx) => (
          <div key={idx} className="capability-card">
            <div className="cap-icon-wrap">{cap.icon}</div>
            <h3 className="cap-title">{cap.title}</h3>
            <p className="cap-desc">{cap.description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
