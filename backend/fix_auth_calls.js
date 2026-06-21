const fs = require('fs');
const path = require('path');

const routesDir = path.join(__dirname, 'src', 'routes');
const authFile = path.join(__dirname, 'src', 'middleware', 'auth.ts');

// 1. Update auth.ts middleware definition
if (fs.existsSync(authFile)) {
  let content = fs.readFileSync(authFile, 'utf8');
  content = content.replace(
    /auth\?: \{\s*userId: string;[\s\S]*?\};/,
    `auth: () => {
    userId: string;
    sessionId?: string;
    actor?: any;
    claims?: any;
  };`
  );
  fs.writeFileSync(authFile, content, 'utf8');
  console.log('Updated auth.ts middleware definition.');
}

// 2. Update all files in routes directory
if (fs.existsSync(routesDir)) {
  const files = fs.readdirSync(routesDir);
  files.forEach(file => {
    const filePath = path.join(routesDir, file);
    if (fs.statSync(filePath).isFile() && (file.endsWith('.ts') || file.endsWith('.js'))) {
      let content = fs.readFileSync(filePath, 'utf8');
      if (content.includes('req.auth?.userId')) {
        content = content.replace(/req\.auth\?\.userId/g, 'req.auth().userId');
        fs.writeFileSync(filePath, content, 'utf8');
        console.log(`Updated req.auth() call in: ${file}`);
      }
    }
  });
}
