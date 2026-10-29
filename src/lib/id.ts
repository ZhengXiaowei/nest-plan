let n = 0;
export const uid = (prefix = 'id') => `${prefix}${Date.now().toString(36)}${(n++).toString(36)}`;
