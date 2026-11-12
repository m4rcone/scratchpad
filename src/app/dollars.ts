/**
 * When a single `$` is maths. `remark-math` takes any two dollars on a line
 * as a formula, so `R$ 600 a R$ 900` renders ` 600 a R` in KaTeX. Here a
 * single `$` opens only when it is not glued to a letter or digit on its
 * left (`R$`, `US$`) and is followed by something other than a space; it
 * closes only after something other than a space and when no digit follows.
 * The space and digit rules are Pandoc's. `$x$`, `$\alpha + 1$` and
 * `costs $5 and $10` behave as a reader expects; `$$…$$`, inline or as a
 * block, is left as `remark-math` has it.
 *
 * The tokenizer is `micromark-extension-math`'s (`lib/math-text.js`) with
 * those checks added; its resolver and `previous` are reused untouched, taken
 * from the construct `remark-math` registered, so nothing here imports the
 * parser's packages.
 */

type Code = number | null;
type State = (code: Code) => State | undefined;
interface Token {
  type: string;
}
interface Effects {
  enter(type: string): Token;
  exit(type: string): Token;
  consume(code: Code): void;
}
interface TokenizeContext {
  previous: Code;
}
interface Construct {
  tokenize: (this: TokenizeContext, effects: Effects, ok: State, nok: State) => State;
}
interface Extension {
  text?: Record<number, Construct | Construct[] | undefined>;
}

const DOLLAR = 36;
const SPACE = 32;

/** micromark's codes below -2 are line endings; -2 and -1 are tab and its padding. */
const isLineEnding = (code: Code): boolean => code !== null && code < -2;

const isBlank = (code: Code): boolean =>
  code === null || code < 0 || /\s/u.test(String.fromCodePoint(code));

const isWordy = (code: Code): boolean =>
  code !== null && code >= 0 && /[\p{L}\p{N}]/u.test(String.fromCodePoint(code));

const isDigit = (code: Code): boolean => code !== null && code >= 48 && code <= 57;

function tokenizeMathText(
  this: TokenizeContext,
  effects: Effects,
  ok: State,
  nok: State,
): State {
  const before = this.previous;
  let sizeOpen = 0;
  let size = 0;
  let token: Token | undefined;
  /** The last character inside the formula, to tell whether a `$` may close it. */
  let last: Code = null;

  return start;

  function start(code: Code): State | undefined {
    effects.enter('mathText');
    effects.enter('mathTextSequence');
    return sequenceOpen(code);
  }

  function sequenceOpen(code: Code): State | undefined {
    if (code === DOLLAR) {
      effects.consume(code);
      sizeOpen++;
      return sequenceOpen;
    }
    if (sizeOpen === 1 && (isWordy(before) || isBlank(code))) return nok(code);
    effects.exit('mathTextSequence');
    return between(code);
  }

  function between(code: Code): State | undefined {
    if (code === null) return nok(code);
    if (code === DOLLAR) {
      token = effects.enter('mathTextSequence');
      size = 0;
      return sequenceClose(code);
    }
    if (code === SPACE || isLineEnding(code)) {
      const type = code === SPACE ? 'space' : 'lineEnding';
      effects.enter(type);
      effects.consume(code);
      effects.exit(type);
      last = code;
      return between;
    }
    effects.enter('mathTextData');
    return data(code);
  }

  function data(code: Code): State | undefined {
    if (code === null || code === SPACE || code === DOLLAR || isLineEnding(code)) {
      effects.exit('mathTextData');
      return between(code);
    }
    effects.consume(code);
    last = code;
    return data;
  }

  function sequenceClose(code: Code): State | undefined {
    if (code === DOLLAR) {
      effects.consume(code);
      size++;
      return sequenceClose;
    }
    if (size === sizeOpen && (sizeOpen > 1 || (!isBlank(last) && !isDigit(code)))) {
      effects.exit('mathTextSequence');
      effects.exit('mathText');
      return ok(code);
    }
    // Not a closing run: the dollars are part of the formula's text.
    if (token) token.type = 'mathTextData';
    last = DOLLAR;
    return data(code);
  }
}

/**
 * Unified plugin, used after `remark-math`: swaps the tokenizer of the
 * inline-maths construct it registered for the one above.
 */
export function strictDollars(this: { data(): Record<string, unknown> }): void {
  const extensions = this.data().micromarkExtensions;
  if (!Array.isArray(extensions)) return;
  for (const extension of extensions as Extension[]) {
    const construct = extension.text?.[DOLLAR];
    if (construct && !Array.isArray(construct)) {
      extension.text![DOLLAR] = { ...construct, tokenize: tokenizeMathText };
    }
  }
}
