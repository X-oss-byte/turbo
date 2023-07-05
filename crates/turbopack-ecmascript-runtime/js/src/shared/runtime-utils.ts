/**
 * This file contains runtime types and functions that are shared between all
 * TurboPack ECMAScript runtimes.
 *
 * It will be prepended to the runtime code of each runtime.
 */

/* eslint-disable @next/next/no-assign-module-variable */

/// <reference path="./runtime-types.d.ts" />

interface Exports {
  __esModule?: boolean;

  [key: string]: any;
}

type EsmNamespaceObject = Record<string, any>;

const REEXPORTED_OBJECTS = Symbol("reexported objects");

interface BaseModule {
  exports: Exports | Promise<Exports> | AsyncModulePromise;
  error: Error | undefined;
  loaded: boolean;
  id: ModuleId;
  children: ModuleId[];
  parents: ModuleId[];
  namespaceObject?:
    | EsmNamespaceObject
    | Promise<EsmNamespaceObject>
    | AsyncModulePromise<EsmNamespaceObject>;
  [REEXPORTED_OBJECTS]?: any[];
}

interface Module extends BaseModule {}

type RequireContextMap = Record<ModuleId, RequireContextEntry>;

interface RequireContextEntry {
  id: () => ModuleId;
}

interface RequireContext {
  (moduleId: ModuleId): Exports | EsmNamespaceObject;

  keys(): ModuleId[];

  resolve(moduleId: ModuleId): ModuleId;
}

type GetOrInstantiateModuleFromParent = (
  moduleId: ModuleId,
  parentModule: Module
) => Module;

type CommonJsRequireContext = (
  entry: RequireContextEntry,
  parentModule: Module
) => Exports;

const hasOwnProperty = Object.prototype.hasOwnProperty;
const toStringTag = typeof Symbol !== "undefined" && Symbol.toStringTag;

function defineProp(
  obj: any,
  name: PropertyKey,
  options: PropertyDescriptor & ThisType<any>
) {
  if (!hasOwnProperty.call(obj, name))
    Object.defineProperty(obj, name, options);
}

/**
 * Adds the getters to the exports object.
 */
function esm(exports: Exports, getters: Record<string, () => any>) {
  defineProp(exports, "__esModule", { value: true });
  if (toStringTag) defineProp(exports, toStringTag, { value: "Module" });
  for (const key in getters) {
    defineProp(exports, key, { get: getters[key], enumerable: true });
  }
}

/**
 * Makes the module an ESM with exports
 */
function esmExport(
  module: Module,
  exports: Exports,
  getters: Record<string, () => any>
) {
  esm((module.namespaceObject = exports), getters);
}

/**
 * Dynamically exports properties from an object
 */
function dynamicExport(
  module: Module,
  exports: Exports,
  object: Record<string, any>
) {
  let reexportedObjects = module[REEXPORTED_OBJECTS];
  if (!reexportedObjects) {
    reexportedObjects = module[REEXPORTED_OBJECTS] = [];

    const namespaceObject = new Proxy(exports, {
      get(target, prop) {
        if (
          hasOwnProperty.call(target, prop) ||
          prop === "default" ||
          prop === "__esModule"
        ) {
          return Reflect.get(target, prop);
        }
        for (const obj of reexportedObjects!) {
          const value = Reflect.get(obj, prop);
          if (value !== undefined) return value;
        }
        return undefined;
      },
      ownKeys(target) {
        const keys = Reflect.ownKeys(target);
        for (const obj of reexportedObjects!) {
          for (const key of Reflect.ownKeys(obj)) {
            if (key !== "default" && !keys.includes(key)) keys.push(key);
          }
        }
        return keys;
      },
    });

    // `exports` passed to this function will always be an object,
    // `module.exports` might have been turned into a promise
    // if this is inside an async module.
    if (isPromise(module.exports)) {
      module.namespaceObject = maybeWrapAsyncModulePromise(
        module.exports,
        () => namespaceObject
      );
    } else {
      module.namespaceObject = namespaceObject;
    }
  }
  reexportedObjects.push(object);
}

function exportValue(module: Module, value: any) {
  module.exports = value;
}

function exportNamespace(module: Module, namespace: any) {
  module.exports = module.namespaceObject = namespace;
}

function createGetter(obj: Record<string, any>, key: string) {
  return () => obj[key];
}

/**
 * @returns prototype of the object
 */
const getProto: (obj: any) => any = Object.getPrototypeOf
  ? (obj) => Object.getPrototypeOf(obj)
  : (obj) => obj.__proto__;

/** Prototypes that are not expanded for exports */
const LEAF_PROTOTYPES = [null, getProto({}), getProto([]), getProto(getProto)];

/**
 * @param raw
 * @param ns
 * @param allowExportDefault
 *   * `false`: will have the raw module as default export
 *   * `true`: will have the default property as default export
 */
function interopEsm(
  raw: Exports,
  ns: EsmNamespaceObject,
  allowExportDefault?: boolean
) {
  const getters: { [s: string]: () => any } = Object.create(null);
  for (
    let current = raw;
    (typeof current === "object" || typeof current === "function") &&
    !LEAF_PROTOTYPES.includes(current);
    current = getProto(current)
  ) {
    for (const key of Object.getOwnPropertyNames(current)) {
      getters[key] = createGetter(raw, key);
    }
  }
  if (!(allowExportDefault && "default" in getters)) {
    getters["default"] = () => raw;
  }
  esm(ns, getters);
  return ns;
}

function esmImport(
  sourceModule: Module,
  id: ModuleId
): Exclude<Module["namespaceObject"], undefined> {
  const module = getOrInstantiateModuleFromParent(id, sourceModule);
  if (module.error) throw module.error;
  if (module.namespaceObject) return module.namespaceObject;
  const raw = module.exports;

  if (isPromise(raw)) {
    module.namespaceObject = maybeWrapAsyncModulePromise(raw, (e) =>
      interopEsm(e, {}, e.__esModule)
    );

    return module.namespaceObject;
  }

  return (module.namespaceObject = interopEsm(raw, {}, raw.__esModule));
}

function commonJsRequire(sourceModule: Module, id: ModuleId): Exports {
  const module = getOrInstantiateModuleFromParent(id, sourceModule);
  if (module.error) throw module.error;
  return module.exports;
}

type RequireContextFactory = (map: RequireContextMap) => RequireContext;

function requireContext(
  sourceModule: Module,
  map: RequireContextMap
): RequireContext {
  function requireContext(id: ModuleId): Exports {
    const entry = map[id];

    if (!entry) {
      throw new Error(
        `module ${id} is required from a require.context, but is not in the context`
      );
    }

    return commonJsRequireContext(entry, sourceModule);
  }

  requireContext.keys = (): ModuleId[] => {
    return Object.keys(map);
  };

  requireContext.resolve = (id: ModuleId): ModuleId => {
    const entry = map[id];

    if (!entry) {
      throw new Error(
        `module ${id} is resolved from a require.context, but is not in the context`
      );
    }

    return entry.id();
  };

  return requireContext;
}

/**
 * Returns the path of a chunk defined by its data.
 */
function getChunkPath(chunkData: ChunkData): ChunkPath {
  return typeof chunkData === "string" ? chunkData : chunkData.path;
}

function isPromise<T = any>(maybePromise: any): maybePromise is Promise<T> {
  return (
    maybePromise != null &&
    typeof maybePromise === "object" &&
    "then" in maybePromise &&
    typeof maybePromise.then === "function"
  );
}

function isAsyncModuleExt<T extends {}>(obj: T): obj is AsyncModuleExt & T {
  return turbopackQueues in obj;
}

function maybeWrapAsyncModulePromise<T, U>(
  promise: Promise<T>,
  then: (val: T) => U | PromiseLike<U>
): typeof promise extends AsyncModulePromise
  ? AsyncModulePromise<U>
  : Promise<U> {
  const newPromise = promise.then(then);

  if (isAsyncModuleExt(promise)) {
    Object.assign(newPromise, {
      get [turbopackExports]() {
        return promise[turbopackExports];
      },
      get [turbopackQueues]() {
        return promise[turbopackQueues];
      },
      get [turbopackError]() {
        return promise[turbopackError];
      },
    } satisfies AsyncModuleExt);
  }

  return newPromise as any;
}

function createPromise<T>() {
  let resolve: (value: T | PromiseLike<T>) => void;
  let reject: (reason?: any) => void;

  const promise = new Promise<T>((res, rej) => {
    reject = rej;
    resolve = res;
  });

  return {
    promise,
    resolve: resolve!,
    reject: reject!,
  };
}

// everything below is adapted from webpack
// https://github.com/webpack/webpack/blob/6be4065ade1e252c1d8dcba4af0f43e32af1bdc1/lib/runtime/AsyncModuleRuntimeModule.js#L13

const turbopackQueues = Symbol("turbopack queues");
const turbopackExports = Symbol("turbopack exports");
const turbopackError = Symbol("turbopack error");

type AsyncQueueFn = (() => void) & { queueCount: number };
type AsyncQueue = AsyncQueueFn[] & { resolved: boolean };

function resolveQueue(queue?: AsyncQueue) {
  if (queue && !queue.resolved) {
    queue.resolved = true;
    queue.forEach((fn) => fn.queueCount--);
    queue.forEach((fn) => (fn.queueCount-- ? fn.queueCount++ : fn()));
  }
}

type Dep = Exports | AsyncModulePromise | Promise<Exports>;

type AsyncModuleExt = {
  [turbopackQueues]: (fn: (queue: AsyncQueue) => void) => void;
  [turbopackExports]: Exports;
  [turbopackError]?: any;
};

type AsyncModulePromise<T = Exports> = Promise<T> & AsyncModuleExt;

function wrapDeps(deps: Dep[]): AsyncModuleExt[] {
  return deps.map((dep) => {
    if (dep !== null && typeof dep === "object") {
      if (isAsyncModuleExt(dep)) return dep;
      if (isPromise(dep)) {
        const queue: AsyncQueue = Object.assign([], { resolved: false });

        const obj: AsyncModuleExt = {
          [turbopackExports]: {},
          [turbopackQueues]: (fn: (queue: AsyncQueue) => void) => fn(queue),
        };

        dep.then(
          (res) => {
            obj[turbopackExports] = res;
            resolveQueue(queue);
          },
          (err) => {
            obj[turbopackError] = err;
            resolveQueue(queue);
          }
        );

        return obj;
      }
    }

    const ret: AsyncModuleExt = {
      [turbopackExports]: dep,
      [turbopackQueues]: () => {},
    };

    return ret;
  });
}

function asyncModule(
  module: Module,
  body: (
    handleAsyncDependencies: (
      deps: Dep[]
    ) => Exports[] | Promise<() => Exports[]>,
    asyncResult: (err?: any) => void
  ) => void,
  hasAwait: boolean
) {
  const queue: AsyncQueue | undefined = hasAwait
    ? Object.assign([], { resolved: true })
    : undefined;

  const depQueues: Set<AsyncQueue> = new Set();
  const exports = module.exports;

  const { resolve, reject, promise: rawPromise } = createPromise<Exports>();

  const promise: AsyncModulePromise = Object.assign(rawPromise, {
    [turbopackExports]: exports,
    [turbopackQueues]: (fn) => {
      queue && fn(queue);
      depQueues.forEach(fn);
      promise["catch"](() => {});
    },
  } satisfies AsyncModuleExt);

  module.exports = promise;

  function handleAsyncDependencies(deps: Dep[]) {
    const currentDeps = wrapDeps(deps);

    const getResult = () =>
      currentDeps.map((d) => {
        if (d[turbopackError]) throw d[turbopackError];
        return d[turbopackExports];
      });

    const { promise, resolve } = createPromise<() => Exports[]>();

    const fn: AsyncQueueFn = Object.assign(() => resolve(getResult), {
      queueCount: 0,
    });

    function fnQueue(q: AsyncQueue) {
      if (q !== queue && !depQueues.has(q)) {
        depQueues.add(q);
        if (q && !q.resolved) {
          fn.queueCount++;
          q.push(fn);
        }
      }
    }

    currentDeps.map((dep) => dep[turbopackQueues](fnQueue));

    return fn.queueCount ? promise : getResult();
  }

  function asyncResult(err?: any) {
    if (err) {
      reject((promise[turbopackError] = err));
    } else {
      resolve(exports);
    }

    resolveQueue(queue);
  }

  body(handleAsyncDependencies, asyncResult);

  if (queue) {
    queue.resolved = false;
  }
}
