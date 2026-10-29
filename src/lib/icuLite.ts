/**
 * Astryx 组件文案用的极简 ICU 格式化，构建时替换掉 intl-messageformat。
 * 原库带完整的 ICU 解析器（约 10 KB gzip），而 Astryx 的文案只用到下面几种写法：
 *   {name}  {n, number}  {n, plural, one {# 项} other {# 项}}  {k, select, a {…} other {…}}
 * 不支持的写法原样输出，不会报错。
 */

type Values = Record<string, unknown>;
type Node = string | {name: string; type?: string; options?: Record<string, Node[]>};

function parse(src: string): Node[] {
  let i = 0;
  const nodes = (inPlural: boolean, depth: number): Node[] => {
    const out: Node[] = [];
    let text = '';
    while (i < src.length) {
      const c = src[i]!;
      if (c === "'") {
        // ICU 转义：'' 是一个撇号，'{…}' 里的内容按原文输出，其它撇号就是普通字符
        const next = src[i + 1];
        if (next === "'") {
          text += "'";
          i += 2;
          continue;
        }
        if (next === '{' || next === '}' || (inPlural && next === '#')) {
          const end = src.indexOf("'", i + 1);
          text += src.slice(i + 1, end < 0 ? undefined : end);
          i = end < 0 ? src.length : end + 1;
          continue;
        }
        text += c;
        i++;
        continue;
      }
      if (c === '}' && depth > 0) break;
      if (c === '#' && inPlural) {
        if (text) out.push(text);
        text = '';
        out.push({name: '#'});
        i++;
        continue;
      }
      if (c === '{') {
        if (text) out.push(text);
        text = '';
        i++;
        out.push(argument());
        continue;
      }
      text += c;
      i++;
    }
    if (text) out.push(text);
    return out;
  };
  const word = () => {
    const m = /^\s*([^\s,{}]+)\s*/.exec(src.slice(i));
    if (!m) return '';
    i += m[0].length;
    return m[1]!;
  };
  const argument = (): Node => {
    const name = word();
    if (src[i] === '}') {
      i++;
      return {name};
    }
    i++; // ,
    const type = word();
    if (src[i] === '}') {
      i++;
      return {name, type};
    }
    i++; // ,
    const options: Record<string, Node[]> = {};
    for (;;) {
      const key = word();
      if (!key || src[i] !== '{') break;
      i++;
      options[key] = nodes(type === 'plural' || type === 'selectordinal', 1);
      i++; // }
    }
    while (i < src.length && src[i] !== '}') i++;
    i++;
    return {name, type, options};
  };
  return nodes(false, 0);
}

const numberFormats = new Map<string, Intl.NumberFormat>();
const pluralRules = new Map<string, Intl.PluralRules>();
const cached = <T>(map: Map<string, T>, key: string, make: () => T) => {
  let v = map.get(key);
  if (!v) map.set(key, (v = make()));
  return v;
};

export default class IntlMessageFormat {
  private readonly ast: Node[];
  constructor(
    message: string,
    private readonly locale: string = 'en',
  ) {
    this.ast = parse(message);
  }

  format(values: Values = {}): string {
    return this.render(this.ast, values, undefined);
  }

  private num(n: number) {
    return cached(numberFormats, this.locale, () => new Intl.NumberFormat(this.locale)).format(n);
  }

  private render(ast: Node[], values: Values, hash: number | undefined): string {
    let out = '';
    for (const node of ast) {
      if (typeof node === 'string') {
        out += node;
        continue;
      }
      if (node.name === '#') {
        out += hash === undefined ? '#' : this.num(hash);
        continue;
      }
      const v = values[node.name];
      if (node.type === 'plural' || node.type === 'selectordinal') {
        const n = Number(v);
        const rules = cached(pluralRules, `${this.locale}|${node.type}`, () => new Intl.PluralRules(this.locale, {type: node.type === 'plural' ? 'cardinal' : 'ordinal'}));
        const o = node.options!;
        const branch = o[`=${n}`] ?? o[rules.select(n)] ?? o.other ?? [];
        out += this.render(branch, values, n);
      } else if (node.type === 'select') {
        const o = node.options!;
        out += this.render(o[String(v)] ?? o.other ?? [], values, hash);
      } else if (node.type === 'number' && typeof v === 'number') {
        out += this.num(v);
      } else {
        out += v === undefined ? `{${node.name}}` : String(v);
      }
    }
    return out;
  }
}
