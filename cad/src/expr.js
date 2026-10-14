// Tiny arithmetic evaluator for {expr} values: numbers, variables, + - * / ( ), unary minus.
// No eval and no function calls.
export function evalExpr(src, vars = {}) {
  const TOKEN = /\d+\.?\d*|\.\d+|[A-Za-z_]\w*|[()+\-*/]/g;
  const toks = src.match(TOKEN) || [];
  // anything that is not a token or whitespace is an error
  if (!toks.length || src.replace(TOKEN, "").trim() !== "") throw new Error(`Cannot read expression "${src}"`);
  let i = 0;
  const peek = () => toks[i];
  const next = () => toks[i++];
  function primary() {
    const t = next();
    if (t === undefined) throw new Error("Expression ends early");
    if (t === "(") {
      const v = sum();
      if (next() !== ")") throw new Error("Missing )");
      return v;
    }
    if (t === "-") return -primary();
    if (t === "+") return primary();
    if (/^[\d.]/.test(t)) return parseFloat(t);
    if (t === "pi") return Math.PI;
    if (Object.hasOwn(vars, t)) return vars[t];
    throw new Error(`Unknown variable "${t}"`);
  }
  function product() {
    let v = primary();
    while (peek() === "*" || peek() === "/") {
      const op = next();
      const r = primary();
      if (op === "/" && r === 0) throw new Error("Division by zero");
      v = op === "*" ? v * r : v / r;
    }
    return v;
  }
  function sum() {
    let v = product();
    while (peek() === "+" || peek() === "-") v = next() === "+" ? v + product() : v - product();
    return v;
  }
  const v = sum();
  if (i < toks.length) throw new Error(`Unexpected "${toks[i]}"`);
  if (!Number.isFinite(v)) throw new Error("Expression is not a finite number");
  return v;
}
