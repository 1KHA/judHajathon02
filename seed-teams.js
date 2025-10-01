require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  console.log('Starting seed...');

  // Sample teams
  const teams = [
    'فريق الأبطال',
    'فريق النجوم',
    'فريق الصقور',
    'فريق الأسود',
    'فريق العمالقة',
    'فريق الفرسان',
    'فريق النسور',
    'فريق الأمل'
  ];

  // Create teams
  for (const teamName of teams) {
    await prisma.team.upsert({
      where: { name: teamName },
      update: {},
      create: { name: teamName }
    });
    console.log(`Created team: ${teamName}`);
  }

  // Sample question bank
  const questionBank = await prisma.questionBank.upsert({
    where: { name: 'بنك الأسئلة العامة' },
    update: {},
    create: { name: 'بنك الأسئلة العامة' }
  });

  console.log(`Created question bank: ${questionBank.name}`);

  // Sample questions
  const questions = [
    {
      text: 'ما هي عاصمة المملكة العربية السعودية؟',
      section: 'جغرافيا',
      weight: 1.0,
      choices: [
        { text: 'الرياض', weight: 1.0 },
        { text: 'جدة', weight: 0.0 },
        { text: 'مكة المكرمة', weight: 0.0 },
        { text: 'المدينة المنورة', weight: 0.0 }
      ],
      correct: 'الرياض'
    },
    {
      text: 'كم عدد أركان الإسلام؟',
      section: 'دين',
      weight: 1.0,
      choices: [
        { text: 'ثلاثة', weight: 0.0 },
        { text: 'أربعة', weight: 0.0 },
        { text: 'خمسة', weight: 1.0 },
        { text: 'ستة', weight: 0.0 }
      ],
      correct: 'خمسة'
    },
    {
      text: 'من هو مؤسس المملكة العربية السعودية؟',
      section: 'تاريخ',
      weight: 1.5,
      choices: [
        { text: 'الملك عبدالعزيز', weight: 1.0 },
        { text: 'الملك فيصل', weight: 0.0 },
        { text: 'الملك خالد', weight: 0.0 },
        { text: 'الملك فهد', weight: 0.0 }
      ],
      correct: 'الملك عبدالعزيز'
    }
  ];

  // Create questions
  for (const question of questions) {
    await prisma.question.create({
      data: {
        text: question.text,
        section: question.section,
        weight: question.weight,
        choices: question.choices,
        correct: question.correct,
        bank: {
          connect: { id: questionBank.id }
        }
      }
    });
    console.log(`Created question: ${question.text}`);
  }

  console.log('Seed completed successfully!');
}

main()
  .catch((e) => {
    console.error('Error during seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
