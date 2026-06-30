const { checkUrl, checkAsset, localAssets, externalServices, runHealthCheck } = require('./health-check');
const https = require('https');
const http = require('http');
const fs = require('fs');

// Mock modules
jest.mock('https');
jest.mock('http');
jest.mock('fs');

describe('Health Check', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('checkUrl', () => {
    it('should return success for 200 status', async () => {
      const mockResponse = { statusCode: 200 };
      const mockRequest = { on: jest.fn(), end: jest.fn() };

      https.request.mockImplementation((url, options, callback) => {
        callback(mockResponse);
        return mockRequest;
      });

      const result = await checkUrl('https://example.com');

      expect(result).toEqual({
        url: 'https://example.com',
        status: 200,
        success: true,
      });
    });

    it('should return failure for 404 status', async () => {
      const mockResponse = { statusCode: 404 };
      const mockRequest = { on: jest.fn(), end: jest.fn() };

      https.request.mockImplementation((url, options, callback) => {
        callback(mockResponse);
        return mockRequest;
      });

      const result = await checkUrl('https://example.com/notfound');

      expect(result).toEqual({
        url: 'https://example.com/notfound',
        status: 404,
        success: false,
      });
    });

    it('should handle network errors', async () => {
      const mockRequest = {
        on: jest.fn((event, handler) => {
          if (event === 'error') handler(new Error('Network error'));
        }),
        end: jest.fn(),
      };

      https.request.mockImplementation(() => mockRequest);

      const result = await checkUrl('https://example.com');

      expect(result).toEqual({
        url: 'https://example.com',
        status: 0,
        success: false,
        error: 'Network error',
      });
    });

    it('should handle timeouts', async () => {
      const mockRequest = {
        on: jest.fn((event, handler) => {
          if (event === 'timeout') handler();
        }),
        destroy: jest.fn(),
        end: jest.fn(),
      };

      https.request.mockImplementation(() => mockRequest);

      const result = await checkUrl('https://example.com');

      expect(result).toEqual({
        url: 'https://example.com',
        status: 0,
        success: false,
        error: 'Timeout',
      });
    });
  });

  describe('checkAsset', () => {
    it('returns success for a valid SVG file', () => {
      fs.readFileSync.mockReturnValue('<svg xmlns="...">...</svg>');
      const result = checkAsset('assets/github-stats-dark.svg');
      expect(result.success).toBe(true);
      expect(result.path).toBe('assets/github-stats-dark.svg');
    });

    it('tolerates leading whitespace before <svg', () => {
      fs.readFileSync.mockReturnValue('\n  <svg></svg>');
      expect(checkAsset('assets/x.svg').success).toBe(true);
    });

    it('fails when the content is not an SVG document', () => {
      fs.readFileSync.mockReturnValue('not an svg at all');
      const result = checkAsset('assets/x.svg');
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Not an SVG/);
    });

    it('fails gracefully when the file is missing', () => {
      fs.readFileSync.mockImplementation(() => {
        throw new Error('ENOENT: no such file');
      });
      const result = checkAsset('assets/missing.svg');
      expect(result.success).toBe(false);
      expect(result.error).toContain('ENOENT');
    });
  });

  describe('configuration', () => {
    it('tracks the two self-hosted SVG stat cards', () => {
      expect(localAssets).toContain('assets/github-stats-dark.svg');
      expect(localAssets).toContain('assets/github-stats-light.svg');
    });

    it('only keeps shields.io as an external dependency', () => {
      expect(externalServices).toHaveLength(1);
      expect(externalServices[0].url).toContain('shields.io');
    });

    it('has no hardcoded username and no dead third-party services', () => {
      const joined = JSON.stringify(externalServices) + JSON.stringify(localAssets);
      expect(joined).not.toContain('shoya-sue');
      expect(joined).not.toContain('herokuapp');
      expect(joined).not.toContain('vercel.app');
      expect(joined).not.toContain('komarev');
    });
  });

  describe('runHealthCheck', () => {
    let logSpy;
    let writeSpy;

    beforeEach(() => {
      logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    });

    afterEach(() => {
      logSpy.mockRestore();
      writeSpy.mockRestore();
    });

    it('returns 0 when all assets are valid and services are reachable', async () => {
      fs.readFileSync.mockReturnValue('<svg></svg>');
      const mockRequest = { on: jest.fn(), end: jest.fn() };
      https.request.mockImplementation((url, options, callback) => {
        callback({ statusCode: 200 });
        return mockRequest;
      });

      const code = await runHealthCheck();
      expect(code).toBe(0);
    });

    it('returns 1 when a self-hosted asset is missing', async () => {
      fs.readFileSync.mockImplementation(() => {
        throw new Error('ENOENT');
      });
      const mockRequest = { on: jest.fn(), end: jest.fn() };
      https.request.mockImplementation((url, options, callback) => {
        callback({ statusCode: 200 });
        return mockRequest;
      });

      const code = await runHealthCheck();
      expect(code).toBe(1);
    });

    it('returns 1 when an external service is unreachable', async () => {
      fs.readFileSync.mockReturnValue('<svg></svg>');
      const mockRequest = {
        on: jest.fn((event, handler) => {
          if (event === 'error') handler(new Error('down'));
        }),
        end: jest.fn(),
      };
      https.request.mockImplementation(() => mockRequest);

      const code = await runHealthCheck();
      expect(code).toBe(1);
    });
  });
});
