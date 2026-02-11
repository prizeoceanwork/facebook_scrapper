import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

// Local development fallback
const isDev = process.env.NODE_ENV === 'development';

export default async function handler(req, res) {
  // Enable CORS so your Railway app can call it
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  
  // Handle preflight request
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  
  // Only allow GET requests
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  let browser = null;
  
  try {
    console.log('Launching browser...');
    
    if (isDev) {
      // Local development - use full puppeteer
      const puppeteerFull = await import('puppeteer');
      browser = await puppeteerFull.launch({
        headless: true,
        args: ['--no-sandbox']
      });
    } else {
      // Vercel production - use chromium
      const executablePath = await chromium.executablePath();
      browser = await puppeteer.launch({
        args: chromium.args,
        executablePath: executablePath,
        headless: chromium.headless,
      });
    }
    
    const page = await browser.newPage();
    
    // Set realistic browser headers
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Referer': 'https://www.facebook.com/',
    });
    
    // Set viewport
    await page.setViewport({ width: 1280, height: 800 });
    
    console.log('Navigating to Facebook group...');
    
    // Go to the group with timeout
    const response = await page.goto('https://www.facebook.com/groups/1358608295902979', {
      waitUntil: 'networkidle2',
      timeout: 30000,
    });
    
    // Check if we hit a login wall
    const url = page.url();
    if (url.includes('login') || url.includes('checkpoint')) {
      console.log('Hit login wall, trying alternative method...');
      
      // Try alternative: look for the member count in the page source
      const html = await page.content();
      await browser.close();
      
      // Try to find member count in HTML
      return extractMemberCount(html, res);
    }
    
    console.log('Extracting member count...');
    
    // Wait a bit for dynamic content
    await page.waitForTimeout(3000);
    
    // Try multiple selectors to find member count
    const memberCount = await page.evaluate(() => {
      // Method 1: Look for text pattern
      const bodyText = document.body.innerText;
      const patterns = [
        /([\d,\.]+[KkM]?)\s*members/i,
        /members[^\d]*([\d,\.]+[KkM]?)/i,
        /([\d,\.]+[KkM]?)\s*group members/i
      ];
      
      for (const pattern of patterns) {
        const match = bodyText.match(pattern);
        if (match) return match[1];
      }
      
      // Method 2: Look for specific elements
      const possibleElements = document.querySelectorAll('span, div, h2, h3');
      for (const el of possibleElements) {
        const text = el.innerText || '';
        if (text.includes('members') && /\d/.test(text)) {
          const match = text.match(/([\d,\.]+[KkM]?)/);
          if (match) return match[1];
        }
      }
      
      return null;
    });
    
    await browser.close();
    
    if (memberCount) {
      const totalMembers = parseMemberCount(memberCount);
      const formattedCount = formatCount(totalMembers);
      
      return res.json({
        totalMembers,
        formattedCount,
        success: true,
        cached: false,
        timestamp: new Date().toISOString()
      });
    } else {
      // Fallback
      return res.json({
        totalMembers: 6700,
        formattedCount: '6.7K',
        success: false,
        fallback: true,
        timestamp: new Date().toISOString()
      });
    }
    
  } catch (error) {
    console.error('Scraper error:', error);
    
    if (browser) {
      await browser.close();
    }
    
    // Always return a value, never fail
    res.json({
      totalMembers: 6700,
      formattedCount: '6.7K',
      success: false,
      fallback: true,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
}

// Helper function to extract member count from HTML
function extractMemberCount(html, res) {
  const patterns = [
    /([\d,\.]+[KkM]?)\s*members/i,
    /members[^\d]*([\d,\.]+[KkM]?)/i,
    /([\d,\.]+[KkM]?)\s*group members/i
  ];
  
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      const totalMembers = parseMemberCount(match[1]);
      return res.json({
        totalMembers,
        formattedCount: formatCount(totalMembers),
        success: true,
        extracted: true
      });
    }
  }
  
  return res.json({
    totalMembers: 6700,
    formattedCount: '6.7K',
    fallback: true
  });
}

// Helper to parse member count string
function parseMemberCount(str) {
  if (str.includes('K') || str.includes('k')) {
    return Math.round(parseFloat(str.replace(/,/g, '')) * 1000);
  } else if (str.includes('M') || str.includes('m')) {
    return Math.round(parseFloat(str.replace(/,/g, '')) * 1000000);
  } else {
    return parseInt(str.replace(/,/g, ''));
  }
}

// Helper to format count
function formatCount(count) {
  if (count >= 1000000) {
    return (count / 1000000).toFixed(1) + 'M';
  } else if (count >= 1000) {
    return (count / 1000).toFixed(1) + 'K';
  }
  return count.toString();
}