Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
let node_worker_threads = require("node:worker_threads");
let node_path = require("node:path");
// src/main/search/engine.ts
let worker = null;
let root = null;
let ctrl = new Int32Array(new SharedArrayBuffer(4));
let seqCounter = 0;
const pending = /* @__PURE__ */ new Map();
let listener = () => {};
function emptyResponse(req, tookMs = 0) {
	return {
		id: req.id,
		matches: [],
		totalFiles: 0,
		totalLines: 0,
		tookMs,
		truncated: false
	};
}
function workerPath() {
	return process.env.FUGLY_SEARCH_WORKER ?? (0, node_path.join)(__dirname, "search-worker.js");
}
async function stopWorker() {
	const w = worker;
	worker = null;
	if (!w) return;
	for (const p of pending.values()) p.resolve(emptyResponse(p.req));
	pending.clear();
	await new Promise((done) => {
		const t = setTimeout(done, 1e3);
		w.once("message", (m) => m.type === "disposed" && (clearTimeout(t), done()));
		w.postMessage({ type: "dispose" });
	});
	await w.terminate();
}
/** Index a workspace (replaces any previous one). Resolves once the worker has started indexing. */
async function openWorkspace(path, onStatus, opts = {}) {
	await stopWorker();
	root = (0, node_path.resolve)(path);
	listener = onStatus;
	ctrl = new Int32Array(new SharedArrayBuffer(4));
	const w = new node_worker_threads.Worker(workerPath(), {
		workerData: { ctrl: ctrl.buffer },
		resourceLimits: { maxOldGenerationSizeMb: 1024 }
	});
	worker = w;
	let first = () => {};
	const firstStatus = new Promise((r) => first = r);
	w.on("message", (m) => {
		if (worker !== w) return;
		if (m.type === "status" && m.status) {
			listener(m.status);
			first(m.status);
		} else if (m.type === "result" && m.seq !== void 0) {
			const p = pending.get(m.seq);
			if (!p) return;
			pending.delete(m.seq);
			const r = m.res;
			r.tookMs = performance.now() - p.t0;
			p.resolve(r);
		}
	});
	const fail = () => {
		if (worker !== w) return;
		worker = null;
		for (const p of pending.values()) p.resolve(emptyResponse(p.req));
		pending.clear();
		first({
			state: "idle",
			files: 0,
			lines: 0,
			root
		});
	};
	w.on("error", fail);
	w.on("exit", fail);
	w.postMessage({
		type: "open",
		root,
		debounceMs: opts.debounceMs
	});
	return firstStatus;
}
function search(req) {
	const w = worker;
	if (!w) return Promise.resolve(emptyResponse(req));
	const seq = ++seqCounter;
	Atomics.store(ctrl, 0, seq);
	return new Promise((res) => {
		pending.set(seq, {
			req,
			t0: performance.now(),
			resolve: res
		});
		w.postMessage({
			type: "search",
			seq,
			id: req.id,
			query: req.query,
			caseSensitive: !!req.caseSensitive,
			maxResults: req.maxResults
		});
	});
}
function getRoot() {
	return root;
}
async function dispose() {
	await stopWorker();
	root = null;
}
exports.dispose = dispose;
exports.getRoot = getRoot;
exports.openWorkspace = openWorkspace;
exports.search = search;
