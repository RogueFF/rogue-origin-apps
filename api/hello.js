/**
 * Hello World endpoint - test that Vercel Functions are working
 * URL: /api/hello
 */

module.exports = (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  res.status(200).json({
    success: true,
    message: 'Vercel Functions are working!',
    timestamp: new Date().toISOString(),
    method: req.method,
    query: req.query,
  });
};
