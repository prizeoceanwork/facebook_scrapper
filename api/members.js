import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const isDev = process.env.NODE_ENV === 'development';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  let browser = null;
  
  try {
    console.log('Launching browser...');
    
    if (isDev) {
      const puppeteerFull = await import('puppeteer');
      browser = await puppeteerFull.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
    } else {
      const executablePath = await chromium.executablePath();
      browser = await puppeteer.launch({
        args: [...chromium.args, '--no-sandbox', '--disable-setuid-sandbox'],
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
    
    await page.setViewport({ width: 1280, height: 800 });
    
    console.log('Navigating to Facebook group...');
    
    await page.goto('https://www.facebook.com/groups/1358608295902979', {
      waitUntil: 'networkidle2',
      timeout: 30000,
    });
    
    // ✅ FIX: Replace waitForTimeout with waitForSelector or setTimeout
    console.log('Waiting for page to load...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // 🔥 CLICK THE CROSS ICON TO CLOSE LOGIN MODAL 🔥
    try {
      console.log('Looking for close button...');
      
      const closeButtonClicked = await page.evaluate(() => {
        // Find the cross icon with the specific classes
        const crossIcon = document.querySelector('i.x1b0d499.x1d69dk1');
        if (crossIcon) {
          crossIcon.click();
          return true;
        }
        
        // Method 2: Find any close button/icon
        const possibleCloseButtons = [
          ...document.querySelectorAll('div[aria-label="Close"]'),
          ...document.querySelectorAll('i[aria-hidden="true"]'),
          ...document.querySelectorAll('svg[aria-label="Close"]'),
          ...document.querySelectorAll('div[role="button"] i'),
          ...document.querySelectorAll('.x1i10hfl.xjbqb8w'),
          ...document.querySelectorAll('[aria-label="Dismiss"]'),
        ];
        
        for (const btn of possibleCloseButtons) {
          if (btn) {
            btn.click();
            return true;
          }
        }
        return false;
      });
      
      if (closeButtonClicked) {
        console.log('✅ Close button clicked, waiting for modal to dismiss...');
        await new Promise(resolve => setTimeout(resolve, 3000));
      } else {
        console.log('❌ No close button found, continuing anyway...');
      }
      
    } catch (clickError) {
      console.log('Error clicking close button:', clickError.message);
    }
    
    // Wait a bit more for content to load
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Check if we're on a login page
    const currentUrl = page.url();
    console.log('Current URL:', currentUrl);
    
    if (currentUrl.includes('login') || currentUrl.includes('checkpoint')) {
      console.log('❌ Still on login page - IP may be blocked');
      await browser.close();
      return res.json({
        totalMembers: 6500, // 🔴 DIFFERENT: 6.5K for IP blocked
        formattedCount: '6.5K',
        success: true,
        fallback: true,
        reason: 'ip_blocked'
      });
    }
    
    console.log('Extracting member count...');
    
    // Try multiple methods to get the member count
    let memberCount = null;
    
    // Method 1: Direct selector for member count
    memberCount = await page.evaluate(() => {
      // Look for the member count in various places
      const selectors = [
        'div[data-pagelet="GroupMetadata"] span',
        'div[role="main"] span',
        'a[href*="members"] span',
        'h2 span',
        'div.x1i10hfl span',
        'span.html-span span',
        'div[aria-label*="members"]',
        'span[dir="auto"]'
      ];
      
      for (const selector of selectors) {
        const elements = document.querySelectorAll(selector);
        for (const el of elements) {
          const text = el.innerText || el.textContent || '';
          if (text.includes('members') || text.includes('Members') || text.includes('total members')) {
            const match = text.match(/([0-9,\.]+[KkM]?)\s*members/i);
            if (match) return match[1];
          }
        }
      }
      return null;
    });
    
    // Method 2: Full page text
    if (!memberCount) {
      memberCount = await page.evaluate(() => {
        const bodyText = document.body.innerText;
        console.log('Page text sample:', bodyText.substring(0, 200));
        const match = bodyText.match(/([0-9,\.]+[KkM]?)\s*members/i);
        return match ? match[1] : null;
      });
    }
    
    // Method 3: Try to find any number near the word "members"
    if (!memberCount) {
      memberCount = await page.evaluate(() => {
        const html = document.body.innerHTML;
        const match = html.match(/([0-9,\.]+[KkM]?)[^<>]*members/i);
        return match ? match[1] : null;
      });
    }
    
    await browser.close();
    
    if (memberCount) {
      console.log('✅ Found member count:', memberCount);
      const totalMembers = parseMemberCount(memberCount);
      
      // Sanity check - if it's suspiciously low, use fallback
      if (totalMembers < 1000) {
        console.log('⚠️ Count too low, using fallback');
        return res.json({
          totalMembers: 6600, // 🔴 DIFFERENT: 6.6K for count too low
          formattedCount: '6.6K',
          success: true,
          fallback: true,
          reason: 'count_too_low'
        });
      }
      
      // ✅ SUCCESS - REAL SCRAPED VALUE
      return res.json({
        totalMembers,
        formattedCount: formatCount(totalMembers),
        success: true,
        scraped: true
      });
    }
    
    console.log('❌ No member count found, using fallback');
    return res.json({
      totalMembers: 6700, // 🔴 DIFFERENT: 6.7K for no count found
      formattedCount: '6.7K',
      success: true,
      fallback: true,
      reason: 'no_count_found'
    });
    
  } catch (error) {
    console.error('Scraper error:', error);
    
    if (browser) {
      await browser.close();
    }
    
    res.json({
      totalMembers: 6800, // 🔴 DIFFERENT: 6.8K for error
      formattedCount: '6.8K',
      success: true,
      fallback: true,
      error: error.message
    });
  }
}

function parseMemberCount(str) {
  if (!str) return 7300;
  const cleanStr = str.replace(/,/g, '');
  if (str.includes('K') || str.includes('k')) {
    return Math.round(parseFloat(cleanStr) * 1000);
  } else if (str.includes('M') || str.includes('m')) {
    return Math.round(parseFloat(cleanStr) * 1000000);
  } else {
    const num = parseInt(cleanStr);
    return isNaN(num) ? 7300 : num;
  }
}

function formatCount(count) {
  if (count >= 1000000) {
    return (count / 1000000).toFixed(1) + 'M';
  } else if (count >= 1000) {
    return (count / 1000).toFixed(1) + 'K';
  }
  return count.toString();
}