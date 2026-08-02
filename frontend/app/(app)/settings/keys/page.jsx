'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import KeyManager from '../../../../components/KeyManager';

function Keys() {
  const params = useSearchParams();
  const error = params.get('error');
  const needs = params.get('needs');

  return (
    <>
      <div className="page-head">
        <h1>API keys</h1>
        <p>
          Postly runs on your own provider accounts, so your content and your quota stay
          yours. Keys are encrypted before they are stored and never shown again.
        </p>
      </div>

      {error && <div className="notice err">{error}</div>}
      {needs && (
        <div className="notice warn">
          Add a {needs} key below to connect accounts.
        </div>
      )}

      <section className="panel">
        <p className="panel-title">Connect social accounts</p>
        <p className="hint" style={{ marginTop: 0, marginBottom: 16 }}>
          These connect your profiles. Each key allows a limited number of connected
          accounts — add a second key to raise the ceiling.
        </p>
        <KeyManager filter={['zernio', 'socialapi']} />
      </section>

      <section className="panel">
        <p className="panel-title">Write the content</p>
        <p className="hint" style={{ marginTop: 0, marginBottom: 16 }}>
          Groq is free and fast. Or bring your own ChatGPT, Gemini or Claude key.
        </p>
        <KeyManager filter={['groq', 'openai', 'gemini', 'anthropic']} />
      </section>
    </>
  );
}

export default function KeysPage() {
  return (
    <Suspense fallback={<div className="skeleton" style={{ height: 200 }} />}>
      <Keys />
    </Suspense>
  );
}
