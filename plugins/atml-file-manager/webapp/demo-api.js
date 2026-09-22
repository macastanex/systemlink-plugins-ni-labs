'use strict';

/*
 * In-browser demo implementation of the File Service, Workspaces, Auth, and
 * Test Monitor calls used by app.js. It is enabled only by ?demo=1 or the
 * local start server, so hosted deployments continue to use real APIs.
 */
(() => {
  const params = new URLSearchParams(window.location.search);
  if (params.get('demo') !== '1') return;

  const DEMO_WORKSPACES = [
    { id: 'demo-lab', name: 'Demo Lab' },
    { id: 'demo-archive', name: 'Demo Archive' },
  ];
  const files = new Map();
  const results = new Map();
  const steps = new Map();
  let nextFile = 1;
  let nextResult = 1;

  const PASSING_ATML = `<?xml version="1.0" encoding="UTF-8"?>
<tr:TestResults xmlns:tr="urn:IEEE-1671:2010:TestResults" xmlns:c="urn:IEEE-1671:2010:Common" xmlns:ts="www.ni.com/TestStand/ATMLTestResults/2.0">
  <tr:ResultSet name="Demo MainSequence Callback" startDateTime="2026-09-01T09:00:00.000Z" endDateTime="2026-09-01T09:00:04.250Z">
    <tr:UUT><c:SerialNumber>DEMO-UUT-001</c:SerialNumber></tr:UUT>
    <tr:TestStation><c:SerialNumber>DEMO-STATION-01</c:SerialNumber></tr:TestStation>
    <tr:SystemOperator name="demo-user"/>
    <tr:Test callerName="Voltage check" name="Voltage check" startDateTime="2026-09-01T09:00:00.000Z" endDateTime="2026-09-01T09:00:02.000Z">
      <tr:Outcome value="Passed"/>
      <ts:StepType>NI_NumericLimitTest</ts:StepType>
      <tr:TestResult name="Voltage">
        <c:TestData><c:Datum value="3.30" unit="V"/></c:TestData>
        <tr:TestLimits><tr:Limits><c:LimitPair><c:Limit comparator="GE"><c:Datum value="3.00"/></c:Limit><c:Limit comparator="LE"><c:Datum value="3.60"/></c:Limit></c:LimitPair></tr:Limits></tr:TestLimits>
      </tr:TestResult>
    </tr:Test>
    <tr:Test callerName="Identity check" name="Identity check" startDateTime="2026-09-01T09:00:02.000Z" endDateTime="2026-09-01T09:00:04.250Z">
      <tr:Outcome value="Passed"/>
      <ts:StepType>NI_StringValueTest</ts:StepType>
      <tr:TestResult name="Part number"><c:TestData><c:Datum value="DEMO-100"/></c:TestData></tr:TestResult>
    </tr:Test>
    <tr:Outcome value="Passed"/>
  </tr:ResultSet>
</tr:TestResults>`;

  const FAILING_ATML = `<?xml version="1.0" encoding="UTF-8"?>
<tr:TestResults xmlns:tr="urn:IEEE-1671:2010:TestResults" xmlns:c="urn:IEEE-1671:2010:Common" xmlns:ts="www.ni.com/TestStand/ATMLTestResults/2.0">
  <tr:ResultSet name="Demo Diagnostics Callback" startDateTime="2026-09-02T14:30:00.000Z" endDateTime="2026-09-02T14:30:01.500Z">
    <tr:UUT><c:SerialNumber>DEMO-UUT-002</c:SerialNumber></tr:UUT>
    <tr:TestStation><c:SerialNumber>DEMO-STATION-01</c:SerialNumber></tr:TestStation>
    <tr:SystemOperator name="demo-user"/>
    <tr:Test callerName="Temperature check" name="Temperature check" startDateTime="2026-09-02T14:30:00.000Z" endDateTime="2026-09-02T14:30:01.500Z">
      <tr:Outcome value="Failed"/>
      <ts:StepType>NI_NumericLimitTest</ts:StepType>
      <tr:TestResult name="Temperature">
        <c:TestData><c:Datum value="87.0" unit="C"/></c:TestData>
        <tr:TestLimits><tr:Limits><c:LimitPair><c:Limit comparator="GE"><c:Datum value="0"/></c:Limit><c:Limit comparator="LE"><c:Datum value="70"/></c:Limit></c:LimitPair></tr:Limits></tr:TestLimits>
      </tr:TestResult>
    </tr:Test>
    <tr:Outcome value="Failed"/>
  </tr:ResultSet>
</tr:TestResults>`;

  const GENERIC_XML = `<?xml version="1.0" encoding="UTF-8"?>
<demo-report><title>Demo XML document</title><message>This file demonstrates the generic XML viewer.</message><items><item id="1">Alpha</item><item id="2">Beta</item></items></demo-report>`;

  function addFile(id, name, workspace, text, created, properties = {}) {
    files.set(id, {
      id,
      workspace,
      properties: { Name: name, ...properties },
      created,
      updated: created,
      size: new TextEncoder().encode(text).length,
      text,
    });
  }

  addFile('demo-file-passing', 'demo-passing.atml', 'demo-lab', PASSING_ATML, '2026-09-01T09:00:04.250Z');
  addFile('demo-file-failing', 'demo-failing.atml', 'demo-lab', FAILING_ATML, '2026-09-02T14:30:01.500Z');
  addFile('demo-file-xml', 'demo-not-atml.xml', 'demo-archive', GENERIC_XML, '2026-08-28T11:15:00.000Z');

  function jsonResponse(value, status = 200) {
    return new Response(JSON.stringify(value), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  function textResponse(value, contentType = 'application/xml') {
    return new Response(value, { headers: { 'Content-Type': contentType } });
  }
  function parseJson(opts) {
    if (typeof opts.body !== 'string') return {};
    try { return JSON.parse(opts.body); } catch { return {}; }
  }
  function publicFile(file) {
    const { text, ...metadata } = file;
    return { ...metadata, properties: { ...metadata.properties } };
  }
  function sortedFiles() {
    return [...files.values()].sort((a, b) => new Date(b.created) - new Date(a.created));
  }
  function fileMatchesSearch(file, filter) {
    if (!filter) return true;
    if (/extension:\s*"(?:xml|atml)"/i.test(filter) && !['xml', 'atml'].includes(file.properties.Name.split('.').pop().toLowerCase())) return false;
    const nameMatch = filter.match(/name:\s*"\*([^\"]*)\*"/i);
    if (nameMatch && !file.properties.Name.toLowerCase().includes(nameMatch[1].toLowerCase())) return false;
    if (/ATML(?:\\\s*|\s+)Checksum/i.test(filter)) {
      const quoted = [...filter.matchAll(/"([^\"]*)"/g)].map((match) => match[1]);
      const checksum = quoted[quoted.length - 1];
      if (!checksum || file.properties['ATML Checksum'] !== checksum) return false;
    }
    return true;
  }
  function fileIdFromPath(pathname) {
    const match = pathname.match(/\/files\/([^/]+)(?:\/|$)/);
    return match ? decodeURIComponent(match[1]) : '';
  }
  function now() { return new Date().toISOString(); }

  async function demoFetch(input, opts = {}) {
    await new Promise((resolve) => setTimeout(resolve, 35));
    const url = new URL(String(input), window.location.href);
    const method = (opts.method || 'GET').toUpperCase();
    const body = parseJson(opts);
    const path = url.pathname;

    if (path === '/niuser/v1/workspaces') return jsonResponse({ workspaces: DEMO_WORKSPACES });
    if (path === '/niauth/v1/auth') {
      return jsonResponse({ policies: [{ statements: [{ workspace: '*', actions: ['*'] }] }] });
    }

    if (path.endsWith('/search-files') && method === 'POST') {
      const matching = sortedFiles().filter((file) => fileMatchesSearch(file, body.filter));
      const skip = Math.max(0, Number(body.skip) || 0);
      const take = body.take == null ? 1000 : Number(body.take);
      return jsonResponse({ availableFiles: matching.slice(skip, take < 0 ? matching.length : skip + take).map(publicFile), totalCount: matching.length, continuationToken: null });
    }

    if (path.endsWith('/query-files') && method === 'POST') {
      const workspace = url.searchParams.get('workspace');
      const matching = sortedFiles().filter((file) => !workspace || file.workspace === workspace);
      const skip = Number(body.skip) || 0;
      const take = Number(body.take) || 1000;
      return jsonResponse({ availableFiles: matching.slice(skip, skip + take).map(publicFile), totalCount: matching.length });
    }

    const dataMatch = path.match(/\/files\/([^/]+)\/data$/);
    if (dataMatch && method === 'GET') {
      const file = files.get(decodeURIComponent(dataMatch[1]));
      return file ? textResponse(file.text) : jsonResponse({ message: 'File not found.' }, 404);
    }

    if (path.endsWith('/upload-files') && method === 'POST') {
      const uploaded = opts.body && opts.body.get ? opts.body.get('file') : null;
      if (!uploaded) return jsonResponse({ message: 'No file supplied.' }, 400);
      const id = `demo-file-upload-${nextFile++}`;
      const workspace = url.searchParams.get('workspace') || 'demo-lab';
      const text = await uploaded.text();
      addFile(id, uploaded.name || `demo-upload-${nextFile}.xml`, workspace, text, now());
      return jsonResponse({ uri: `/nifile/v1/service-groups/Default/files/${id}` }, 201);
    }

    if (path.endsWith('/delete-files') && method === 'POST') {
      for (const id of body.ids || []) files.delete(id);
      return jsonResponse({ ids: body.ids || [] });
    }

    const metadataMatch = path.match(/\/files\/([^/]+)\/update-metadata$/);
    if (metadataMatch && method === 'POST') {
      const file = files.get(decodeURIComponent(metadataMatch[1]));
      if (!file) return jsonResponse({ message: 'File not found.' }, 404);
      Object.assign(file.properties, body.properties || {});
      file.updated = now();
      return jsonResponse(publicFile(file));
    }

    if (path === '/nitestmonitor/v2/query-results' && method === 'POST') {
      const checksum = body.substitutions && body.substitutions[0];
      const matching = [...results.values()].filter((result) => !checksum || result.properties['ATML Checksum'] === checksum);
      return jsonResponse({ results: matching.map((result) => ({ ...result, properties: { ...result.properties }, fileIds: [...(result.fileIds || [])] })), totalCount: matching.length });
    }

    if (path === '/nitestmonitor/v2/results' && method === 'POST') {
      const created = (body.results || []).map((request) => {
        const id = `demo-result-${nextResult++}`;
        const result = { ...request, id, updatedAt: now(), properties: { ...(request.properties || {}) }, fileIds: [...(request.fileIds || [])] };
        results.set(id, result);
        return result;
      });
      return jsonResponse({ results: created }, 201);
    }

    if (path === '/nitestmonitor/v2/delete-results' && method === 'POST') {
      for (const id of body.ids || []) {
        results.delete(id);
        steps.delete(id);
      }
      return jsonResponse({ ids: body.ids || [] });
    }

    if (path === '/nitestmonitor/v2/update-results' && method === 'POST') {
      for (const update of body.results || []) {
        const result = results.get(update.id);
        if (!result) continue;
        result.properties = { ...result.properties, ...(update.properties || {}) };
        result.updatedAt = now();
      }
      return jsonResponse({ results: (body.results || []).map((update) => results.get(update.id)).filter(Boolean) });
    }

    if (path === '/nitestmonitor/v2/steps' && method === 'POST') {
      const created = body.steps || [];
      for (const step of created) {
        if (!steps.has(step.resultId)) steps.set(step.resultId, []);
        steps.get(step.resultId).push(step);
      }
      return jsonResponse({ steps: created });
    }

    return jsonResponse({ message: `Demo API has no route for ${method} ${path}.` }, 404);
  }

  window.__ATML_DEMO_MODE__ = true;
  window.__ATML_DEMO_API__ = { fetch: demoFetch };
})();
