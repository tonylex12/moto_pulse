const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const routes = await prisma.savedRoute.findMany({
    orderBy: { createdAt: 'desc' },
  });
  console.log(`Found ${routes.length} routes.`);
  for (const route of routes) {
    console.log(`\nRoute ID: ${route.id}`);
    console.log(`Name: ${route.name}`);
    console.log(`Distance: ${route.distance} km`);
    console.log(`Created At: ${route.createdAt}`);
    if (route.coordinates) {
      console.log(`Number of coordinates: ${route.coordinates.length}`);
      if (route.coordinates.length > 0) {
        console.log(`First point:`, route.coordinates[0]);
        console.log(`Last point:`, route.coordinates[route.coordinates.length - 1]);
        if (route.coordinates.length > 2) {
          console.log(`Middle point:`, route.coordinates[Math.floor(route.coordinates.length / 2)]);
        }
      }
    }
  }
}

main()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect());
