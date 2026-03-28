const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const budgets = await prisma.budget.findMany();
  console.log(JSON.stringify(budgets, null, 2));
}

main()
  .catch(e => console.error(e))
  .finally(async () => await prisma.$disconnect());
