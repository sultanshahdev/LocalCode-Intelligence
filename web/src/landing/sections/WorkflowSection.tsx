import React from 'react';
import { FolderGit2, HelpCircle, FileCheck } from 'lucide-react';

export function WorkflowSection() {
  const steps = [
    {
      step: '01',
      icon: <FolderGit2 size={24} className="wf-step-icon" />,
      title: 'Connect Repository',
      desc: 'Point to any local project folder or public GitHub URL. LocalCode discovers source files and checks eligibility without touching git commits or creating temp clutter.',
    },
    {
      step: '02',
      icon: <HelpCircle size={24} className="wf-step-icon" />,
      title: 'Ask a Question',
      desc: 'Describe the feature, bug, or subsystem you want to explore. Vector search processes your query locally to surface the highest-similarity code candidates.',
    },
    {
      step: '03',
      icon: <FileCheck size={24} className="wf-step-icon" />,
      title: 'Inspect the Evidence',
      desc: 'Examine exact source code with line numbers, navigate symbols, view possible usages, or inspect the codebase location on the 2D architectural map.',
    },
  ];

  return (
    <section id="how-it-works" className="landing-workflow-section">
      <div className="landing-section-header">
        <span className="section-pre-title">Simple 3-Step Workflow</span>
        <h2 className="section-main-title">How LocalCode works</h2>
        <p className="section-sub-title">From an unfamiliar repo to verified source code in seconds.</p>
      </div>

      <div className="workflow-grid">
        {steps.map((st, i) => (
          <div key={i} className="workflow-card">
            <div className="workflow-step-num">{st.step}</div>
            <div className="workflow-card-icon">{st.icon}</div>
            <h3 className="workflow-card-title">{st.title}</h3>
            <p className="workflow-card-desc">{st.desc}</p>
            {i < steps.length - 1 && (
              <div className="workflow-connector" aria-hidden="true">
                <span className="workflow-line" />
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
