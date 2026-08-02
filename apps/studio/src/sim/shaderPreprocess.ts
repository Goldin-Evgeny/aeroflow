/**
 * A tiny `#define`-style preprocessor for WGSL variant selection (M6, step 4).
 *
 * WGSL has no preprocessor, so we emulate a minimal C-style one over comment-safe
 * directives placed at the start of a line (leading whitespace allowed):
 *
 *   //#ifdef  NAME      … block included when NAME is a defined flag
 *   //#ifndef NAME      … block included when NAME is NOT defined
 *   //#else
 *   //#endif
 *
 * Plus scalar token substitution: any `${NAME}` in the source is replaced by the string
 * value of `defines[NAME]` (used for compile-time constants like grid dimensions). A flag
 * is "defined" if its key is present with any non-`false`/non-`undefined` value.
 *
 * Kept deliberately small: no nesting-depth tricks beyond a simple stack, no expression
 * evaluation. The 3D kernel selects `STORAGE_FP16` and `TRT` this way.
 */

export type DefineValue = string | number | boolean;
export type Defines = Record<string, DefineValue | undefined>;

function isDefined(defines: Defines, name: string): boolean {
  const v = defines[name];
  return v !== undefined && v !== false;
}

const IFDEF = /^\s*\/\/#ifdef\s+(\w+)\s*$/;
const IFNDEF = /^\s*\/\/#ifndef\s+(\w+)\s*$/;
const ELSE = /^\s*\/\/#else\s*$/;
const ENDIF = /^\s*\/\/#endif\s*$/;

interface Frame {
  /** Is the branch currently being emitted active? */
  active: boolean;
  /** Was any branch in this if/else chain taken (⇒ #else is inactive)? */
  taken: boolean;
  /** Is the enclosing scope emitting at all? */
  parentActive: boolean;
}

export function preprocessShader(source: string, defines: Defines = {}): string {
  const out: string[] = [];
  const stack: Frame[] = [];
  const emitting = () => stack.every((f) => f.active);

  const lines = source.split('\n');
  for (let ln = 0; ln < lines.length; ln++) {
    const line = lines[ln];

    let m: RegExpMatchArray | null;
    if ((m = line.match(IFDEF))) {
      const parentActive = emitting();
      const cond = parentActive && isDefined(defines, m[1]);
      stack.push({ active: cond, taken: cond, parentActive });
      continue;
    }
    if ((m = line.match(IFNDEF))) {
      const parentActive = emitting();
      const cond = parentActive && !isDefined(defines, m[1]);
      stack.push({ active: cond, taken: cond, parentActive });
      continue;
    }
    if (ELSE.test(line)) {
      const frame = stack[stack.length - 1];
      if (!frame) throw new Error(`shaderPreprocess: #else without #ifdef (line ${ln + 1})`);
      frame.active = frame.parentActive && !frame.taken;
      frame.taken = true;
      continue;
    }
    if (ENDIF.test(line)) {
      if (stack.pop() === undefined)
        throw new Error(`shaderPreprocess: #endif without #ifdef (line ${ln + 1})`);
      continue;
    }

    if (emitting()) out.push(line);
  }

  if (stack.length > 0) throw new Error('shaderPreprocess: unterminated #ifdef (missing #endif)');

  let result = out.join('\n');
  // Scalar substitution: ${NAME} → String(defines[NAME]).
  result = result.replace(/\$\{(\w+)\}/g, (whole, name: string) => {
    const v = defines[name];
    if (v === undefined || v === false)
      throw new Error(`shaderPreprocess: \${${name}} used but not defined`);
    return String(v);
  });
  return result;
}
