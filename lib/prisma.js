const { PrismaClient } = require('@prisma/client');

let prisma;

// Configure DATABASE_URL with connection pooling parameters
const getDatabaseUrl = () => {
  const baseUrl = process.env.DATABASE_URL;
  if (!baseUrl) return baseUrl;
  
  // Add connection pooling parameters if not already present
  const url = new URL(baseUrl);
  if (!url.searchParams.has('connection_limit')) {
    url.searchParams.set('connection_limit', '5');
  }
  if (!url.searchParams.has('pool_timeout')) {
    url.searchParams.set('pool_timeout', '10');
  }
  if (!url.searchParams.has('schema')) {
    url.searchParams.set('schema', 'public');
  }
  
  return url.toString();
};

if (process.env.NODE_ENV === 'production') {
  // Create new instance for each serverless invocation in production
  prisma = new PrismaClient({
    datasources: {
      db: {
        url: getDatabaseUrl()
      }
    },
    log: ['error', 'warn'],
    errorFormat: 'minimal',
    // Add connection management options
    __internal: {
      engine: {
        connectTimeout: 10000,
        queryTimeout: 10000
      }
    }
  });
  
  // Disconnect on process termination
  process.on('beforeExit', async () => {
    await prisma.$disconnect();
  });
} else {
  // Use global singleton in development
  if (!global.prisma) {
    global.prisma = new PrismaClient({
      datasources: {
        db: {
          url: getDatabaseUrl()
        }
      },
      log: ['query', 'info', 'warn', 'error'],
      errorFormat: 'pretty'
    });
  }
  prisma = global.prisma;
}

module.exports = prisma;