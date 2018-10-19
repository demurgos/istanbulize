import { parse as babelParse } from "@babel/parser";
import babelTraverse, { NodePath } from "@babel/traverse";
import { File, Function as FunctionNode, Node, Program, SourceLocation, Statement } from "@babel/types";
import { FunctionCov, RangeCov, ScriptCov } from "@c88/v8-coverage";
import Protocol from "devtools-protocol";
import Module from "module";
import {
  IstanbulBranch,
  IstanbulBranchCoverageData,
  IstanbulFileCoverageData,
  IstanbulFnCoverageData,
  IstanbulFunction,
  IstanbulStatementCoverageData,
} from "./types";

export {
  IstanbulBranch,
  IstanbulBranchCoverageData,
  IstanbulFileCoverageData,
  IstanbulFnCoverageData,
  IstanbulFunction,
  IstanbulStatementCoverageData,
} from "./types";
export { ScriptCov, FunctionCov, RangeCov } from "@c88/v8-coverage";

export enum SourceType {
  Script = "script",
  Module = "module",
}

export interface IstambulizeScriptOptions {
  /**
   * The source text must be wrapped if the scriptcovs are wrapped.
   */
  sourceText: string;
  sourceType: SourceType;
}

export type WrapperLike = [string | number, string | number];

export interface istanbulizeOptions extends IstambulizeScriptOptions {
  scriptCov: ScriptCov;
}

type FunctionLike = FunctionNode | Program;

/**
 * Converts a V8 ScriptCoverage object to an Istanbul FileCoverage data object.
 */
export function istanbulize(options: Readonly<istanbulizeOptions>): IstanbulFileCoverageData {
  const script: IstambulizeScript = new IstambulizeScript(options);
  script.add(options.scriptCov);
  return script.toIstanbul();
}

const ROOT_SYMBOL: unique symbol = Symbol("root");

export class IstambulizeScript {
  private path: string | undefined;
  private readonly ast: File;
  private readonly roots: Set<FunctionLike>;
  private readonly functionNames: Map<FunctionNode, string>;
  private readonly functionCounts: Map<FunctionNode, number>;
  private readonly statementCounts: Map<Statement, number>;

  public constructor(options: Readonly<IstambulizeScriptOptions>) {
    this.path = undefined;
    this.ast = babelParse(
      options.sourceText,
      {
        sourceType: options.sourceType,
        plugins: ["dynamicImport"],
      },
    );
    this.roots = new Set();
    this.functionNames = new Map();
    this.functionCounts = new Map();
    this.statementCounts = new Map();

    babelTraverse(this.ast, {
      enter: (path: NodePath) => {
        if (path.isFunction() || path.isProgram()) {
          this.roots.add(path.node);
          (path.node as any)[ROOT_SYMBOL] = path.node;
        } else {
          const parent: Node | undefined = path.parent;
          const parentRoot: Node | undefined = parent !== undefined ? ((parent as any)[ROOT_SYMBOL]) : undefined;
          if (parentRoot !== undefined) {
            (path.node as any)[ROOT_SYMBOL] = parentRoot;
          }
        }
        if (path.isFunction()) {
          this.functionCounts.set(path.node, 0);
        }
        if (path.isStatement() && !(path.isBlockStatement() || path.isFunctionDeclaration())) {
          this.statementCounts.set(path.node, 0);
        }
      },
    });
  }

  public add(scriptCov: ScriptCov): void {
    this.path = scriptCov.url;
    const funcs: Map<FunctionLike, FunctionCov> = matchFunctions(this.roots, scriptCov.functions);
    for (const [node, funcCov] of funcs) {
      if (node.type !== "Program") {
        addCount(this.functionCounts, node, funcCov.ranges[0].count);
        this.functionNames.set(node, funcCov.functionName);
      }
    }
    for (const [statement, oldCount] of this.statementCounts) {
      const root: FunctionLike | undefined = (statement as any)[ROOT_SYMBOL];
      if (root === undefined) {
        continue;
      }
      const funcCov: FunctionCov | undefined = funcs.get(root);
      if (funcCov === undefined) {
        continue;
      }
      const count: number = getCount(funcCov.ranges, statement);
      this.statementCounts.set(statement, oldCount + count);
    }
  }

  public toIstanbul(): IstanbulFileCoverageData {
    return {
      path: this.path !== undefined ? this.path : "",
      ...this.getStatements(),
      ...this.getFunctions(),
      ...this.getBranches(),
    };
  }

  private getStatements<S extends keyof any = keyof any>(): IstanbulStatementCoverageData<S> {
    const statementMap: Record<S, SourceLocation> = Object.create(null);
    const s: Record<S, number> = Object.create(null);

    let i: number = 0;
    for (const [statementNode, count] of this.statementCounts) {
      const key: string = `s${i}`;
      i++;
      // assert loc is defined
      statementMap[key] = statementNode.loc!;
      s[key] = count;
    }

    return {statementMap, s};
  }

  private getFunctions<F extends keyof any = keyof any>(): IstanbulFnCoverageData<F> {
    const fnMap: Record<F, IstanbulFunction> = Object.create(null);
    const f: Record<F, number> = Object.create(null);

    let i: number = 0;
    for (const [funcNode, count] of this.functionCounts) {
      const key: string = `f${i}`;
      i++;
      const name: string | undefined = this.functionNames.get(funcNode);
      // assert loc is defined
      fnMap[key] = {
        name: name !== undefined ? name : "",
        decl: funcNode.loc!,
        loc: funcNode.loc!,
        line: funcNode.loc!.start.line,
      };
      f[key] = count;
    }
    return {fnMap, f};
  }

  private getBranches<B extends keyof any = keyof any>(): IstanbulBranchCoverageData<B> {
    const branchMap: Record<B, IstanbulBranch> = Object.create(null);
    const b: Record<B, number[]> = Object.create(null);

    // for (const block of this.blocks) {
    //   babelTraverse(
    //     block.node,
    //     {
    //       enter: (path: NodePath) => {
    //         if (path.isConditionalExpression()) {
    //           const condExpr: ConditionalExpression = path.node;
    //           const {consequent, alternate} = condExpr;
    //           const key: string = this.nextBid();
    //           // assert loc is defined
    //           branchMap[key] = {
    //             type: "cond-expr",
    //             line: condExpr.loc!.start.line,
    //             loc: condExpr.loc!,
    //             locations: [consequent.loc!, alternate.loc!],
    //           };
    //           b[key] = [
    //             getCount(block.v8.ranges, consequent),
    //             getCount(block.v8.ranges, alternate),
    //           ];
    //         }
    //       },
    //     },
    //     block.scope,
    //     block.path,
    //   );
    // }
    return {branchMap, b};
  }
}

function addCount(counts: Map<Node, number> | WeakMap<Node, number>, node: Node, count: number): void {
  const oldCount: number | undefined = counts.get(node);
  if (oldCount === undefined) {
    throw new Error("UnknownNode");
  }
  counts.set(node, oldCount + count);
}

function matchFunctions(
  funcNodes: Iterable<FunctionLike>,
  funcCovs: Iterable<FunctionCov>,
): Map<FunctionLike, FunctionCov> {
  const remaining: FunctionCov[] = [...funcCovs];
  const matched: Map<FunctionLike, FunctionCov> = new Map();

  for (const funcNode of funcNodes) {
    let matchedIndex: number | undefined;
    for (let i: number = remaining.length - 1; i >= 0; i--) {
      const funcCov: FunctionCov = remaining[i];
      const funcRange: RangeCov = funcCov.ranges[0];
      if (funcRange.startOffset === funcNode.start && funcRange.endOffset === funcNode.end) {
        matchedIndex = i;
        break;
      }
    }
    if (matchedIndex !== undefined) {
      matched.set(funcNode, remaining[matchedIndex]);
      remaining.splice(matchedIndex, 1);
    }
  }

  return matched;
}

function resolveWrapper(wrapper: WrapperLike = (Module as any).wrapper): [number, number] {
  const [prefix, suffix] = wrapper;
  const prefixLen: number = typeof prefix === "number" ? prefix : prefix.length;
  const suffixLen: number = typeof suffix === "number" ? suffix : suffix.length;
  return [prefixLen, suffixLen];
}

export function unwrapScriptCov(scriptCov: ScriptCov, wrapper: WrapperLike = (Module as any).wrapper): ScriptCov {
  if (scriptCov.functions.length === 0) {
    return scriptCov;
  }
  const rootFunc: FunctionCov = scriptCov.functions[0];
  if (rootFunc.ranges.length === 0) {
    throw new Error("InvalidScriptCov: expected `functions[0].ranges.length > 0`");
  }
  const rootRange: RangeCov = rootFunc.ranges[0];
  const [prefixLen, suffixLen] = resolveWrapper(wrapper);
  const bodyStart = prefixLen;
  const bodyEnd = rootRange.endOffset - suffixLen;
  const bodyLen = bodyEnd - bodyStart;

  const functions: FunctionCov[] = [];
  for (const func of scriptCov.functions) {
    const ranges: RangeCov[] = [];
    for (const range of func.ranges) {
      const startOffset: number = Math.max(range.startOffset - bodyStart, 0);
      const endOffset: number = Math.min(range.endOffset - bodyStart, bodyLen);
      if (startOffset < endOffset) {
        ranges.push({startOffset, endOffset, count: range.count});
      }
    }
    if (ranges.length > 0) {
      functions.push({...func, ranges});
    }
  }
  return {...scriptCov, functions};
}

export function unwrapSourceText(sourceText: string, wrapper: WrapperLike = (Module as any).wrapper): string {
  const [prefixLen, suffixLen] = resolveWrapper(wrapper);
  return sourceText.substring(prefixLen, sourceText.length - suffixLen);
}

interface CovBlock {
  node: Node;
  scope: any;
  path: any;
  v8: Protocol.Profiler.FunctionCoverage;
  isFunction: boolean;
}

// class Converter {
//   public static convert(
//     coverage: V8Coverage,
//     sourceText: string,
//     sourceType: ModuleType,
//   ): IstanbulFileCoverageData {
//     const ast: File = babelParse(sourceText, {sourceType, plugins: ["dynamicImport"]});
//     const converter = new Converter(ast, coverage);
//     return {
//       path: coverage.url,
//       ...converter.getStatements(),
//       ...converter.getFunctions(),
//       ...converter.getBranches(),
//     };
//   }
//
//   // boolean: isFunction
//   private readonly ast: File;
//   private readonly blocks: Set<CovBlock>;
//   private readonly blockRoots: Set<Node>;
//   // tslint:disable-next-line:variable-name
//   private _nextFid: number;
//   // tslint:disable-next-line:variable-name
//   private _nextSid: number;
//   // tslint:disable-next-line:variable-name
//   private _nextBid: number;
//
//   private constructor(ast: File, coverage: V8Coverage) {
//     this.ast = ast;
//     this.blocks = new Set();
//     this.blockRoots = new Set();
//     this._nextFid = 0;
//     this._nextSid = 0;
//     this._nextBid = 0;
//
//     const unmatchedV8: FnCov[] = [...coverage.functions];
//     babelTraverse(ast, {
//       enter: (path: NodePath) => {
//         const v8: FnCov | undefined = popMatchedV8(unmatchedV8, path.node);
//         if (v8 !== undefined) {
//           this.blocks.add({v8, node: path.node, scope: path.scope, path, isFunction: path.isFunction()});
//           this.blockRoots.add(path.node);
//         }
//       },
//     });
//     if (unmatchedV8.length > 0) {
//       throw new Error("Unable to match all V8 function to an AST Node");
//     }
//   }
//
//   private nextFid(): string {
//     return `f${this._nextFid++}`;
//   }
//
//   private nextSid(): string {
//     return `s${this._nextSid++}`;
//   }
//
//   private nextBid(): string {
//     return `b${this._nextBid++}`;
//   }
//
//   private getStatements<S extends keyof any = keyof any>(): IstanbulStatementCoverageData<S> {
//     const statementMap: Record<S, SourceLocation> = Object.create(null);
//     const s: Record<S, number> = Object.create(null);
//
//     for (const block of this.blocks) {
//       babelTraverse(
//         block.node,
//         {
//           enter: (path: NodePath) => {
//             if (path.isStatement() && !(path.isBlockStatement() || path.isFunctionDeclaration())) {
//               const key: string = this.nextSid();
//               // assert loc is defined
//               statementMap[key] = path.node.loc!;
//               s[key] = getCount(block.v8.ranges, path.node);
//             }
//             if (this.blockRoots.has(path.node)) {
//               path.skip();
//             }
//           },
//         },
//         block.scope,
//         block.path,
//       );
//     }
//     return {statementMap, s};
//   }
//
//   private getFunctions<F extends keyof any = keyof any>(): IstanbulFnCoverageData<F> {
//     const fnMap: Record<F, IstanbulFunction> = Object.create(null);
//     const f: Record<F, number> = Object.create(null);
//
//     for (const block of this.blocks) {
//       if (!block.isFunction) {
//         continue;
//       }
//       const key: string = this.nextFid();
//       // assert loc is defined
//       fnMap[key] = {
//         name: block.v8.functionName,
//         decl: block.node.loc!,
//         loc: block.node.loc!,
//         line: block.node.loc!.start.line,
//       };
//       f[key] = block.v8.ranges[0].count;
//     }
//     return {fnMap, f};
//   }
//
//   private getBranches<B extends keyof any = keyof any>(): IstanbulBranchCoverageData<B> {
//     const branchMap: Record<B, IstanbulBranch> = Object.create(null);
//     const b: Record<B, number[]> = Object.create(null);
//
//     for (const block of this.blocks) {
//       babelTraverse(
//         block.node,
//         {
//           enter: (path: NodePath) => {
//             if (path.isConditionalExpression()) {
//               const condExpr: ConditionalExpression = path.node;
//               const {consequent, alternate} = condExpr;
//               const key: string = this.nextBid();
//               // assert loc is defined
//               branchMap[key] = {
//                 type: "cond-expr",
//                 line: condExpr.loc!.start.line,
//                 loc: condExpr.loc!,
//                 locations: [consequent.loc!, alternate.loc!],
//               };
//               b[key] = [
//                 getCount(block.v8.ranges, consequent),
//                 getCount(block.v8.ranges, alternate),
//               ];
//             }
//           },
//         },
//         block.scope,
//         block.path,
//       );
//     }
//     return {branchMap, b};
//   }
// }
//
// function popMatchedV8(v8List: FnCov[], node: Node): FnCov | undefined {
//   let matchedIdx: number | undefined;
//   for (const [idx, v8] of v8List.entries()) {
//     const firstRange = v8.ranges[0];
//     if (firstRange.startOffset === node.start && firstRange.endOffset === node.end) {
//       matchedIdx = idx;
//       break;
//     }
//   }
//   if (matchedIdx === undefined) {
//     return undefined;
//   }
//   return v8List.splice(matchedIdx, 1)[0];
// }

function getCount(rangeCovs: ReadonlyArray<RangeCov>, node: Node): number {
  for (let i = rangeCovs.length - 1; i >= 0; i--) {
    const rangeCov: RangeCov = rangeCovs[i];
    if (rangeCov.startOffset <= node.start! && node.end! <= rangeCov.endOffset) {
      return rangeCov.count;
    }
  }
  throw new Error("Count not found");
}
