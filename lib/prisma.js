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
  // Add prepared statement handling to avoid conflicts
  if (!url.searchParams.has('statement_timeout')) {
    url.searchParams.set('statement_timeout', '30s');
  }
  if (!url.searchParams.has('idle_in_transaction_session_timeout')) {
    url.searchParams.set('idle_in_transaction_session_timeout', '30s');
  }
  
  return url.toString();
};

// Global prisma instance for production with connection management
if (process.env.NODE_ENV === 'production') {
  if (!global.prisma) {
    global.prisma = new PrismaClient({
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
    
    // Handle prepared statement cleanup
    global.prisma.$on('beforeExit', async () => {
      try {
        await global.prisma.$executeRaw`DEALLOCATE ALL`;
      } catch (error) {
        console.log('Prepared statement cleanup:', error.message);
      }
      await global.prisma.$disconnect();
    });
  }
  prisma = global.prisma;
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