const math = require('./math');

test('adds 1 + 2 to equal 3', () => {
  expect(math.add(1, 2)).toBe(3);
});

// Purposely omitting subtract, multiply, and divide tests to force coverage < 80%
