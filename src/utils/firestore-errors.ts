import { auth } from '../firebase';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}

export function safeJsonStringify(obj: any): string {
  if (obj === undefined) return 'undefined';
  if (obj === null) return 'null';
  
  const seen = new Set<any>();
  
  function customStringify(val: any, depth: number = 0): string {
    if (depth > 5) return '"[Max Depth Reached]"';
    if (val === null) return 'null';
    if (val === undefined) return 'undefined';
    if (typeof val === 'string') return JSON.stringify(val);
    if (typeof val === 'number' || typeof val === 'boolean') return String(val);
    if (typeof val === 'function') return '"[Function]"';
    if (typeof val === 'symbol') return '"[Symbol]"';
    if (typeof val === 'bigint') return `"${val.toString()}"`;
    
    if (typeof val === 'object') {
      if (seen.has(val)) {
        return '"[Circular]"';
      }
      seen.add(val);
      
      if (Array.isArray(val)) {
        const items = val.map(item => customStringify(item, depth + 1));
        seen.delete(val);
        return '[' + items.join(',') + ']';
      }
      
      if (val instanceof Error) {
        const errObj: any = {
          name: val.name,
          message: val.message,
          stack: val.stack
        };
        for (const k of Object.keys(val)) {
          try {
            errObj[k] = (val as any)[k];
          } catch (_) {}
        }
        const res = customStringify(errObj, depth + 1);
        seen.delete(val);
        return res;
      }
      
      const parts: string[] = [];
      const keys = Object.keys(val);
      for (const key of keys) {
        try {
          const propVal = val[key];
          parts.push(JSON.stringify(key) + ':' + customStringify(propVal, depth + 1));
        } catch (e) {
          parts.push(JSON.stringify(key) + ':"[Unreadable: ' + (e instanceof Error ? e.message : String(e)) + ']"');
        }
      }
      seen.delete(val);
      return '{' + parts.join(',') + '}';
    }
    
    return '"[Unknown Type]"';
  }

  try {
    return customStringify(obj);
  } catch (err) {
    try {
      const simpleSeen = new WeakSet();
      return JSON.stringify(obj, (key, value) => {
        if (typeof value === 'object' && value !== null) {
          if (simpleSeen.has(value)) return '[Circular]';
          simpleSeen.add(value);
        }
        return value;
      });
    } catch (fallbackErr) {
      return `[Serialization Failed: ${fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)}]`;
    }
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', safeJsonStringify(errInfo));
  throw new Error(safeJsonStringify(errInfo));
}
