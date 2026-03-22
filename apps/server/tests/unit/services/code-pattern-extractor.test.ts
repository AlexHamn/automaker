import { describe, it, expect } from 'vitest';
import {
  shouldSkipDir,
  shouldIndexFile,
  classifyFile,
  extractPatterns,
} from '@/services/code-pattern-extractor.js';

describe('Code Pattern Extractor', () => {
  describe('shouldSkipDir', () => {
    it('should skip common build directories', () => {
      expect(shouldSkipDir('node_modules')).toBe(true);
      expect(shouldSkipDir('dist')).toBe(true);
      expect(shouldSkipDir('build')).toBe(true);
      expect(shouldSkipDir('.git')).toBe(true);
      expect(shouldSkipDir('coverage')).toBe(true);
      expect(shouldSkipDir('.automaker')).toBe(true);
    });

    it('should skip hidden directories', () => {
      expect(shouldSkipDir('.cache')).toBe(true);
      expect(shouldSkipDir('.next')).toBe(true);
    });

    it('should not skip source directories', () => {
      expect(shouldSkipDir('src')).toBe(false);
      expect(shouldSkipDir('lib')).toBe(false);
      expect(shouldSkipDir('components')).toBe(false);
      expect(shouldSkipDir('services')).toBe(false);
    });
  });

  describe('shouldIndexFile', () => {
    it('should index TypeScript files', () => {
      expect(shouldIndexFile('src/index.ts', 1000)).toBe(true);
      expect(shouldIndexFile('src/App.tsx', 5000)).toBe(true);
    });

    it('should index JavaScript files', () => {
      expect(shouldIndexFile('src/utils.js', 1000)).toBe(true);
      expect(shouldIndexFile('src/Component.jsx', 2000)).toBe(true);
    });

    it('should skip non-code files', () => {
      expect(shouldIndexFile('src/styles.css', 1000)).toBe(false);
      expect(shouldIndexFile('README.md', 1000)).toBe(false);
      expect(shouldIndexFile('package.json', 500)).toBe(false);
    });

    it('should skip large files', () => {
      expect(shouldIndexFile('src/huge.ts', 60000)).toBe(false);
    });

    it('should skip declaration files', () => {
      expect(shouldIndexFile('src/types.d.ts', 1000)).toBe(false);
    });

    it('should skip generated files', () => {
      expect(shouldIndexFile('src/routeTree.gen.ts', 1000)).toBe(false);
    });
  });

  describe('classifyFile', () => {
    it('should classify route files', () => {
      expect(classifyFile('src/routes/users.ts')).toBe('route');
      expect(classifyFile('apps/server/src/routes/auth/index.ts')).toBe('route');
    });

    it('should classify component files', () => {
      expect(classifyFile('src/components/Button.tsx')).toBe('component');
      expect(classifyFile('apps/ui/src/components/views/board-view.tsx')).toBe('component');
    });

    it('should classify service files', () => {
      expect(classifyFile('src/services/auth-service.ts')).toBe('service');
    });

    it('should classify hook files', () => {
      expect(classifyFile('src/hooks/use-auth.ts')).toBe('hook');
      expect(classifyFile('src/use-query.ts')).toBe('hook');
    });

    it('should classify type/model files', () => {
      expect(classifyFile('src/types/user.ts')).toBe('model');
      expect(classifyFile('src/models/feature.ts')).toBe('model');
    });

    it('should classify utility files', () => {
      expect(classifyFile('src/lib/utils.ts')).toBe('utility');
      expect(classifyFile('src/utils/format.ts')).toBe('utility');
    });

    it('should classify test files', () => {
      expect(classifyFile('src/auth.test.ts')).toBe('test');
      expect(classifyFile('src/__tests__/utils.ts')).toBe('test');
    });
  });

  describe('extractPatterns', () => {
    it('should extract exported functions', () => {
      const content = `
import { db } from './db';

export function createUser(name: string): User {
  return db.insert({ name });
}

export async function deleteUser(id: string): Promise<void> {
  await db.delete(id);
}
`;
      const result = extractPatterns('src/services/user.ts', content);

      expect(result.patternType).toBe('service');
      expect(result.exportedNames).toContain('createUser');
      expect(result.exportedNames).toContain('deleteUser');
      expect(result.enrichedContent).toContain('createUser');
      expect(result.enrichedContent).toContain('deleteUser');
    });

    it('should extract exported classes', () => {
      const content = `
export class AuthService {
  constructor(private db: Database) {}
}
`;
      const result = extractPatterns('src/services/auth.ts', content);

      expect(result.exportedNames).toContain('AuthService');
      expect(result.enrichedContent).toContain('AuthService');
    });

    it('should extract exported interfaces and types', () => {
      const content = `
export interface User {
  id: string;
  name: string;
}

export type Status = 'active' | 'inactive';
`;
      const result = extractPatterns('src/types/user.ts', content);

      expect(result.patternType).toBe('model');
      expect(result.exportedNames).toContain('User');
      expect(result.exportedNames).toContain('Status');
    });

    it('should extract TODO comments', () => {
      const content = `
// TODO: Add validation
export function save() {}
// FIXME: This is broken
`;
      const result = extractPatterns('src/lib/save.ts', content);

      expect(result.enrichedContent).toContain('TODO: Add validation');
      expect(result.enrichedContent).toContain('FIXME: This is broken');
    });

    it('should extract import statements', () => {
      const content = `
import { useState } from 'react';
import { db } from './database';

export const App = () => {};
`;
      const result = extractPatterns('src/components/App.tsx', content);

      expect(result.enrichedContent).toContain("import { useState } from 'react'");
      expect(result.enrichedContent).toContain("import { db } from './database'");
    });

    it('should include file header with type', () => {
      const content = `export function handler() {}`;
      const result = extractPatterns('src/routes/api.ts', content);

      expect(result.enrichedContent).toContain('# src/routes/api.ts');
      expect(result.enrichedContent).toContain('Type: route');
    });

    it('should extract exported consts', () => {
      const content = `
export const UserCard = ({ name }: { name: string }) => {
  return <div>{name}</div>;
};

export const MAX_ITEMS = 100;
`;
      const result = extractPatterns('src/components/UserCard.tsx', content);

      expect(result.exportedNames).toContain('UserCard');
      expect(result.exportedNames).toContain('MAX_ITEMS');
    });
  });
});
