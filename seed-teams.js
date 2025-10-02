require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DIRECT_URL || process.env.DATABASE_URL
    }
  }
});

async function main() {
  console.log('Starting seed...');

  // Categorized teams
  const teamCategories = {
    'مسار التحديات الصحية': [
      'عين الرحمة',
      'PocketAid',
      'سند',
      'ظليل',
      'لَبيب',
      'إتزان',
      'سلامة - Salama',
      'SafeVision'
    ],
    'مسار التحديات البيئية': [
      'بتلقاه - Betlqah',
      'إماطة',
      'خُطى مُستَدامَة',
      'سِرْبَال',
      'وَصل',
      'نديم',
      'إرتواء – Ertwa',
      'ريفيرت'
    ],
    'مسار تحديات البنية التحتية': [
      'طويق',
      'رَقِيب – RAQEEB',
      'GREENCAP',
      'خُطى',
      'أفق',
      'معراج',
      'سراج'
    ],
    'مسار إدارة الحشود': [
      'اشراقة النور',
      'منارة \\ منارة الحشود الذكية',
      'نبيه',
      'تطبيق رشد',
      'وفود',
      'آمِن',
      'نسك ترانزيت',
      'SafeCrowd | الحشود الآمنه',
      'لم شمل الافراد الضائعين'
    ]
  };

  // Create teams per category
  for (const [category, teams] of Object.entries(teamCategories)) {
    for (const teamName of teams) {
      const trimmedName = teamName.trim();
      await prisma.team.upsert({
        where: { name: trimmedName },
        update: { teamCategory: category },
        create: { name: trimmedName, teamCategory: category }
      });
      console.log(`Created team: ${trimmedName} (${category})`);
    }
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
