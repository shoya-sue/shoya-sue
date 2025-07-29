const { checkUrl, dynamicObjects } = require('./health-check');
const https = require('https');
const http = require('http');

// Mock modules
jest.mock('https');
jest.mock('http');

describe('Health Check', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('checkUrl', () => {
    it('should return success for 200 status', async () => {
      const mockResponse = {
        statusCode: 200
      };
      
      const mockRequest = {
        on: jest.fn(),
        end: jest.fn()
      };
      
      https.request.mockImplementation((url, options, callback) => {
        callback(mockResponse);
        return mockRequest;
      });

      const result = await checkUrl('https://example.com');
      
      expect(result).toEqual({
        url: 'https://example.com',
        status: 200,
        success: true
      });
    });

    it('should return failure for 404 status', async () => {
      const mockResponse = {
        statusCode: 404
      };
      
      const mockRequest = {
        on: jest.fn(),
        end: jest.fn()
      };
      
      https.request.mockImplementation((url, options, callback) => {
        callback(mockResponse);
        return mockRequest;
      });

      const result = await checkUrl('https://example.com/notfound');
      
      expect(result).toEqual({
        url: 'https://example.com/notfound',
        status: 404,
        success: false
      });
    });

    it('should handle network errors', async () => {
      const mockRequest = {
        on: jest.fn((event, handler) => {
          if (event === 'error') {
            handler(new Error('Network error'));
          }
        }),
        end: jest.fn()
      };
      
      https.request.mockImplementation(() => mockRequest);

      const result = await checkUrl('https://example.com');
      
      expect(result).toEqual({
        url: 'https://example.com',
        status: 0,
        success: false,
        error: 'Network error'
      });
    });

    it('should handle timeouts', async () => {
      const mockRequest = {
        on: jest.fn((event, handler) => {
          if (event === 'timeout') {
            handler();
          }
        }),
        destroy: jest.fn(),
        end: jest.fn()
      };
      
      https.request.mockImplementation(() => mockRequest);

      const result = await checkUrl('https://example.com');
      
      expect(result).toEqual({
        url: 'https://example.com',
        status: 0,
        success: false,
        error: 'Timeout'
      });
    });
  });

  describe('dynamicObjects', () => {
    it('should contain all required dynamic objects', () => {
      expect(dynamicObjects).toHaveLength(10);
      
      const objectNames = dynamicObjects.map(obj => obj.name);
      expect(objectNames).toContain('Header Capsule Render');
      expect(objectNames).toContain('Typing SVG');
      expect(objectNames).toContain('GitHub Stats');
      expect(objectNames).toContain('Streak Stats');
      expect(objectNames).toContain('Activity Graph');
      expect(objectNames).toContain('GitHub Trophies');
      expect(objectNames).toContain('Profile View Counter');
    });

    it('should have valid URLs for all objects', () => {
      dynamicObjects.forEach(obj => {
        expect(obj.url).toMatch(/^https?:\/\//);
        expect(obj.type).toMatch(/^(svg|gif|png)$/);
      });
    });
  });

  describe('Integration Tests', () => {
    it('should verify all URLs are properly formatted', () => {
      const urls = dynamicObjects.map(obj => obj.url);
      
      // Check specific service URLs
      expect(urls.some(url => url.includes('capsule-render.vercel.app'))).toBe(true);
      expect(urls.some(url => url.includes('readme-typing-svg.herokuapp.com'))).toBe(true);
      expect(urls.some(url => url.includes('github-stats-alpha.vercel.app'))).toBe(true);
      expect(urls.some(url => url.includes('streak-stats.demolab.com'))).toBe(true);
      expect(urls.some(url => url.includes('github-readme-activity-graph.vercel.app'))).toBe(true);
      expect(urls.some(url => url.includes('github-trophies.vercel.app'))).toBe(true);
      expect(urls.some(url => url.includes('komarev.com/ghpvc'))).toBe(true);
    });

    it('should include username parameter in relevant URLs', () => {
      const userSpecificObjects = [
        'GitHub Stats',
        'Streak Stats',
        'Activity Graph',
        'GitHub Trophies',
        'Profile View Counter'
      ];

      userSpecificObjects.forEach(name => {
        const obj = dynamicObjects.find(o => o.name === name);
        expect(obj).toBeDefined();
        expect(obj.url).toContain('shoya-sue');
      });
    });
  });
});