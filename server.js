require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client');
const { createClient } = require('@supabase/supabase-js');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const prisma = new PrismaClient();
const app = express();

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const PORT = process.env.PORT || 3000;
const judgePIN = process.env.JUDGE_PIN || '1234';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// API Routes

// Get Supabase configuration for frontend
app.get('/api/supabase-config', (req, res) => {
  res.json({
    url: process.env.SUPABASE_URL,
    anonKey: process.env.SUPABASE_ANON_KEY
  });
});

// Get initial data for host
app.get('/api/host/init', async (req, res) => {
  try {
    const teams = await prisma.team.findMany({
      select: { name: true, teamCategory: true },
      orderBy: [
        { teamCategory: 'asc' },
        { name: 'asc' }
      ]
    });
    const questions = await prisma.question.findMany({
      distinct: ['text'],
      select: { id: true, text: true, section: true, weight: true }
    });
    const questionBanks = await prisma.questionBank.findMany({
      include: {
        questions: {
          select: { id: true, text: true, section: true, weight: true }
        }
      }
    });

    const teamCategories = teams.reduce((acc, team) => {
      const category = team.teamCategory || 'غير مصنف';
      if (!acc[category]) {
        acc[category] = [];
      }
      acc[category].push(team.name);
      return acc;
    }, {});
    
    res.json({
      teams: teams.map(t => t.name),
      teamCategories,
      questions,
      questionBanks,
      sections: [...new Set(questions.map(q => q.section))]
    });
  } catch (error) {
    console.error('Error fetching host data:', error);
    res.status(500).json({ error: 'Failed to fetch data' });
  }
});

// Join as judge
app.post('/api/judge/join', async (req, res) => {
  const { pin, name, sessionId } = req.body;
  
  if (!name || name.trim() === '') {
    return res.status(400).json({ error: 'Name is required' });
  }
  
  if (pin !== judgePIN) {
    return res.status(401).json({ error: 'Invalid Game PIN' });
  }
  
  try {
    const judgeToken = uuidv4();
    
    // Find active session if sessionId provided, otherwise find any active session
    let session = null;
    if (sessionId) {
      session = await prisma.session.findFirst({
        where: { sessionId, status: { in: ['waiting', 'active'] } }
      });
    } else {
      session = await prisma.session.findFirst({
        where: { status: { in: ['waiting', 'active'] } },
        orderBy: { createdAt: 'desc' }
      });
    }
    
    const judge = await prisma.judge.upsert({
      where: { name },
      create: { 
        name,
        judgeToken,
        isOnline: true,
        sessionId: session?.id || null
      },
      update: { 
        judgeToken,
        isOnline: true,
        sessionId: session?.id || null
      }
    });
    
    // Create session event for judge joining
    if (session) {
      await prisma.sessionEvent.create({
        data: {
          sessionId: session.id,
          eventType: 'judge_joined',
          eventData: { 
            judgeName: judge.name,
            judgeId: judge.id
          }
        }
      });
    }
    
    res.json({ 
      success: true,
      judge: {
        id: judge.id,
        name: judge.name,
        judgeToken: judge.judgeToken
      },
      sessionId: session?.sessionId || null
    });
  } catch (error) {
    console.error('Error creating judge:', error);
    res.status(500).json({ error: 'Failed to join session' });
  }
});

// Create session and set teams
app.post('/api/session/create', async (req, res) => {
  const { teamNames } = req.body;
  
  if (!teamNames || teamNames.length === 0) {
    return res.status(400).json({ error: 'Please select at least one team' });
  }
  
  try {
    const sessionId = uuidv4();
    const hostToken = uuidv4();
    
    const session = await prisma.session.create({
      data: {
        name: `Session ${sessionId}`,
        sessionId: sessionId,
        hostToken: hostToken,
        currentTeamIndex: 0,
        teams: JSON.stringify(teamNames),
        answersByTeam: JSON.stringify({}),
        status: 'waiting'
      }
    });
    
    // Link selected teams to the session
    const allTeams = await prisma.team.findMany({
      where: { name: { in: teamNames } }
    });
    
    for (const team of allTeams) {
      await prisma.sessionTeam.create({
        data: {
          session: { connect: { id: session.id } },
          team: { connect: { id: team.id } }
        }
      });
    }
    
    // Create session event
    await prisma.sessionEvent.create({
      data: {
        sessionId: session.id,
        eventType: 'session_created',
        eventData: { teams: teamNames }
      }
    });
    
    res.json({
      sessionId,
      hostToken,
      teams: teamNames
    });
  } catch (error) {
    console.error('Error creating session:', error);
    res.status(500).json({ error: 'Failed to create session' });
  }
});

// Start questions
app.post('/api/session/:sessionId/start-questions', async (req, res) => {
  const { sessionId } = req.params;
  const { questionIds, hostToken } = req.body;
  
  try {
    // Verify session and host token
    const session = await prisma.session.findFirst({
      where: { sessionId, hostToken }
    });
    
    if (!session) {
      return res.status(401).json({ error: 'Invalid session or host token' });
    }
    
    // Link questions to session
    const questionIdInts = questionIds.map(q => parseInt(q.id));
    const allQuestions = await prisma.question.findMany({
      where: { id: { in: questionIdInts } }
    });
    
    for (const question of allQuestions) {
      const exists = await prisma.sessionQuestion.findFirst({
        where: {
          sessionId: session.id,
          questionId: question.id
        }
      });
      if (!exists) {
        await prisma.sessionQuestion.create({
          data: {
            session: { connect: { id: session.id } },
            question: { connect: { id: question.id } }
          }
        });
      }
    }
    
    // Get current team with enhanced error handling
    const teams = JSON.parse(session.teams);
    const currentTeamName = teams[session.currentTeamIndex];
    
    console.log('=== TEAM LOOKUP DEBUG ===');
    console.log('Session ID:', session.id);
    console.log('Current team index:', session.currentTeamIndex);
    console.log('Looking for team:', currentTeamName);
    console.log('Available teams:', teams);
    
    if (!currentTeamName) {
      console.error('ERROR: No team name found at index', session.currentTeamIndex);
      return res.status(400).json({ error: 'No current team found' });
    }
    
    // First, try to find existing team
    let currentTeam = await prisma.team.findFirst({
      where: { name: currentTeamName }
    });
    
    console.log('Existing team found:', currentTeam ? `ID: ${currentTeam.id}` : 'None');
    
    // If team not found, create it
    if (!currentTeam) {
      console.log('Creating new team:', currentTeamName);
      try {
        currentTeam = await prisma.team.create({
          data: { name: currentTeamName }
        });
        console.log('Team created successfully with ID:', currentTeam.id);
      } catch (createError) {
        console.error('Error creating team:', createError);
        // Try to find it again in case it was created by another request
        currentTeam = await prisma.team.findFirst({
          where: { name: currentTeamName }
        });
      }
    }
    
    const teamId = currentTeam?.id || null;
    console.log('Final teamId:', teamId, 'for team:', currentTeamName);
    console.log('=== END TEAM LOOKUP DEBUG ===');
    
    if (!teamId) {
      console.error('CRITICAL ERROR: Could not get team ID for team:', currentTeamName);
      return res.status(500).json({ error: 'Failed to resolve team ID' });
    }
    
    // Update session with current questions
    await prisma.session.update({
      where: { id: session.id },
      data: {
        currentQuestions: JSON.stringify(allQuestions),
        currentTeamId: teamId,
        status: 'active'
      }
    });
    
    // Create event
    await prisma.sessionEvent.create({
      data: {
        sessionId: session.id,
        eventType: 'questions_started',
        eventData: {
          questions: allQuestions,
          currentTeam: currentTeamName,
          teamId: teamId
        }
      }
    });
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error starting questions:', error);
    res.status(500).json({ error: 'Failed to start questions' });
  }
});

// Change team
app.post('/api/session/:sessionId/change-team', async (req, res) => {
  const { sessionId } = req.params;
  const { direction, hostToken } = req.body;
  
  try {
    const session = await prisma.session.findFirst({
      where: { sessionId, hostToken }
    });
    
    if (!session) {
      return res.status(401).json({ error: 'Invalid session or host token' });
    }
    
    const teams = JSON.parse(session.teams);
    let newIndex = session.currentTeamIndex;
    
    if (direction === 'next' && newIndex < teams.length - 1) {
      newIndex++;
    } else if (direction === 'previous' && newIndex > 0) {
      newIndex--;
    }
    
    await prisma.session.update({
      where: { id: session.id },
      data: { currentTeamIndex: newIndex }
    });
    
    // Create event
    await prisma.sessionEvent.create({
      data: {
        sessionId: session.id,
        eventType: 'team_changed',
        eventData: {
          currentTeam: teams[newIndex],
          currentTeamIndex: newIndex
        }
      }
    });
    
    res.json({ 
      success: true,
      currentTeam: teams[newIndex],
      currentTeamIndex: newIndex
    });
  } catch (error) {
    console.error('Error changing team:', error);
    res.status(500).json({ error: 'Failed to change team' });
  }
});

// End session
app.post('/api/session/:sessionId/end', async (req, res) => {
  const { sessionId } = req.params;
  const { hostToken } = req.body;
  
  try {
    const session = await prisma.session.findFirst({
      where: { sessionId, hostToken }
    });
    
    if (!session) {
      return res.status(401).json({ error: 'Invalid session or host token' });
    }
    
    // Update session status to ended
    await prisma.session.update({
      where: { id: session.id },
      data: { status: 'ended' }
    });
    
    // Create session ended event
    await prisma.sessionEvent.create({
      data: {
        sessionId: session.id,
        eventType: 'session_ended',
        eventData: { 
          sessionId: session.sessionId,
          endedAt: new Date().toISOString()
        }
      }
    });
    
    // Set all judges offline for this session
    await prisma.judge.updateMany({
      where: { sessionId: session.id },
      data: { isOnline: false }
    });
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error ending session:', error);
    res.status(500).json({ error: 'Failed to end session' });
  }
});

// Submit answer
app.post('/api/answer/submit', async (req, res) => {
  const { sessionId, judgeToken, answer, questionIndex } = req.body;
  
  try {
    // Verify judge
    const judge = await prisma.judge.findFirst({
      where: { judgeToken }
    });
    
    if (!judge) {
      return res.status(401).json({ error: 'Invalid judge token' });
    }
    
    // Get session
    const session = await prisma.session.findFirst({
      where: { sessionId }
    });
    
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    // Get current team
    const teams = JSON.parse(session.teams);
    const currentTeam = await prisma.team.findFirst({
      where: { name: teams[session.currentTeamIndex] }
    });
    
    if (!currentTeam) {
      return res.status(404).json({ error: 'Team not found' });
    }
    
    // Get question
    const question = await prisma.question.findUnique({
      where: { id: questionIndex }
    });
    
    if (!question) {
      return res.status(404).json({ error: 'Question not found' });
    }
    
    // Calculate points
    const answerText = typeof answer === 'object' ? answer.text : answer;
    const points = calculateAnswerPoints(question, answer);
    
    // Save answer
    const savedAnswer = await prisma.answer.create({
      data: {
        answer: answerText,
        points: points,
        question: { connect: { id: questionIndex } },
        team: { connect: { id: currentTeam.id } },
        judge: { connect: { id: judge.id } },
        session: { connect: { id: session.id } }
      }
    });
    
    // Create event
    await prisma.sessionEvent.create({
      data: {
        sessionId: session.id,
        eventType: 'answer_submitted',
        eventData: {
          judgeName: judge.name,
          teamName: currentTeam.name,
          answer: answerText,
          points: points
        }
      }
    });
    
    res.json({ success: true, answerId: savedAnswer.id });
  } catch (error) {
    console.error('Error submitting answer:', error);
    res.status(500).json({ error: 'Failed to submit answer' });
  }
});

// Submit final answers
app.post('/api/answer/submit-final', async (req, res) => {
  const { sessionId, judgeToken, teamId, answers } = req.body;
  
  try {
    const judge = await prisma.judge.findFirst({
      where: { judgeToken }
    });
    
    if (!judge) {
      return res.status(401).json({ error: 'Invalid judge token' });
    }
    
    const session = await prisma.session.findFirst({
      where: { sessionId }
    });
    
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    // Save final answers
    await prisma.finalAnswer.upsert({
      where: {
        sessionId_teamId_judgeId: {
          sessionId: session.id,
          teamId: parseInt(teamId),
          judgeId: judge.id
        }
      },
      create: {
        sessionId: session.id,
        teamId: parseInt(teamId),
        judgeId: judge.id,
        answers: JSON.stringify(answers)
      },
      update: {
        answers: JSON.stringify(answers)
      }
    });
    
    // Get team and judge info for the event
    const team = await prisma.team.findUnique({
      where: { id: parseInt(teamId) }
    });
    
    // Calculate and update team results
    await updateTeamResults(session.id, parseInt(teamId));
    
    // Create event for final answers submission
    await prisma.sessionEvent.create({
      data: {
        sessionId: session.id,
        eventType: 'final_answers_submitted',
        eventData: {
          judgeName: judge.name,
          teamName: team?.name || 'Unknown Team',
          teamId: parseInt(teamId),
          answersCount: answers.length
        }
      }
    });
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error submitting final answers:', error);
    res.status(500).json({ error: 'Failed to submit final answers' });
  }
});

// Get judges for a session
app.get('/api/session/:sessionId/judges', async (req, res) => {
  const { sessionId } = req.params;
  
  try {
    const session = await prisma.session.findFirst({
      where: { sessionId }
    });
    
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    const judges = await prisma.judge.findMany({
      where: { sessionId: session.id, isOnline: true },
      select: { id: true, name: true, isOnline: true, createdAt: true }
    });
    
    res.json({ judges });
  } catch (error) {
    console.error('Error fetching judges:', error);
    res.status(500).json({ error: 'Failed to fetch judges' });
  }
});

// Find team by name (helper endpoint for fallback)
app.get('/api/team/find/:teamName', async (req, res) => {
  const { teamName } = req.params;
  
  try {
    const team = await prisma.team.findFirst({
      where: { name: teamName }
    });
    
    if (!team) {
      return res.status(404).json({ error: 'Team not found' });
    }
    
    res.json({ team: { id: team.id, name: team.name } });
  } catch (error) {
    console.error('Error finding team:', error);
    res.status(500).json({ error: 'Failed to find team' });
  }
});

// Get complete session snapshot (enhanced version for real-time sync)
app.get('/api/session/:sessionId/snapshot', async (req, res) => {
  const { sessionId } = req.params;
  
  try {
    const session = await prisma.session.findFirst({
      where: { sessionId },
      include: {
        sessionTeams: {
          include: { team: true }
        },
        sessionQuestions: {
          include: { question: true }
        },
        judges: {
          where: { isOnline: true },
          select: { id: true, name: true, isOnline: true }
        }
      }
    });
    
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    const teams = JSON.parse(session.teams || '[]');
    const currentQuestions = session.currentQuestions ? JSON.parse(session.currentQuestions) : [];
    const currentTeamName = teams[session.currentTeamIndex];
    
    // Get all answers for this session grouped by team
    const allAnswers = await prisma.answer.findMany({
      where: { sessionId: session.id },
      include: {
        judge: { select: { name: true } },
        team: { select: { name: true } },
        question: { select: { text: true } }
      }
    });
    
    // Get all final answers for this session
    const finalAnswers = await prisma.finalAnswer.findMany({
      where: { sessionId: session.id },
      include: {
        judge: { select: { name: true } },
        team: { select: { name: true } }
      }
    });
    
    // Group answers by team
    const answersByTeam = {};
    
    // Add individual answers
    allAnswers.forEach(answer => {
      const teamName = answer.team.name;
      if (!answersByTeam[teamName]) {
        answersByTeam[teamName] = [];
      }
      answersByTeam[teamName].push({
        player: answer.judge.name,
        answer: answer.answer,
        points: answer.points,
        question: answer.question.text
      });
    });
    
    // Add final answers
    finalAnswers.forEach(finalAnswer => {
      const teamName = finalAnswer.team.name;
      if (!answersByTeam[teamName]) {
        answersByTeam[teamName] = [];
      }
      const answers = JSON.parse(finalAnswer.answers);
      answersByTeam[teamName].push({
        player: finalAnswer.judge.name,
        answer: `إجابات نهائية مُرسلة (${answers.length} إجابات)`,
        points: 0
      });
    });
    
    // Get leaderboard
    const results = await prisma.sessionResult.findMany({
      where: { sessionId: session.id },
      include: { team: true }
    });
    
    const leaderboard = results.map(result => {
      const details = JSON.parse(result.details);
      const answers = details.answers || [];
      
      const totalPoints = answers.reduce((sum, answer) => {
        return sum + (parseFloat(answer.points) || 0);
      }, 0);
      
      return {
        teamName: result.team.name,
        totalPoints: Math.round(totalPoints * 100) / 100
      };
    });
    
    leaderboard.sort((a, b) => b.totalPoints - a.totalPoints);
    
    res.json({
      session: {
        id: session.id,
        sessionId: session.sessionId,
        status: session.status,
        currentTeamIndex: session.currentTeamIndex,
        currentTeam: currentTeamName,
        currentTeamId: session.currentTeamId,
        teams: teams,
        currentQuestions: currentQuestions,
        judges: session.judges,
        answersByTeam: answersByTeam,
        leaderboard: leaderboard
      }
    });
  } catch (error) {
    console.error('Error fetching session snapshot:', error);
    res.status(500).json({ error: 'Failed to fetch session snapshot' });
  }
});

// Get session state
app.get('/api/session/:sessionId/state', async (req, res) => {
  const { sessionId } = req.params;
  
  try {
    const session = await prisma.session.findFirst({
      where: { sessionId },
      include: {
        sessionTeams: {
          include: { team: true }
        },
        sessionQuestions: {
          include: { question: true }
        },
        judges: {
          where: { isOnline: true },
          select: { id: true, name: true, isOnline: true }
        }
      }
    });
    
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    const teams = JSON.parse(session.teams || '[]');
    const currentQuestions = session.currentQuestions ? JSON.parse(session.currentQuestions) : [];
    
    console.log('=== SESSION STATE DEBUG ===');
    console.log('Session currentTeamId:', session.currentTeamId);
    console.log('Current team index:', session.currentTeamIndex);
    console.log('Teams array:', teams);
    console.log('Current team name:', teams[session.currentTeamIndex]);
    console.log('=== END SESSION STATE DEBUG ===');
    
    res.json({
      session: {
        id: session.id,
        sessionId: session.sessionId,
        status: session.status,
        currentTeamIndex: session.currentTeamIndex,
        currentTeam: teams[session.currentTeamIndex],
        currentTeamId: session.currentTeamId, // Include the team ID
        teams: teams,
        currentQuestions: currentQuestions,
        totalPoints: session.totalPoints,
        judges: session.judges
      }
    });
  } catch (error) {
    console.error('Error fetching session state:', error);
    res.status(500).json({ error: 'Failed to fetch session state' });
  }
});

// Get leaderboard
app.get('/api/session/:sessionId/leaderboard', async (req, res) => {
  const { sessionId } = req.params;
  
  try {
    const session = await prisma.session.findFirst({
      where: { sessionId }
    });
    
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    const results = await prisma.sessionResult.findMany({
      where: { sessionId: session.id },
      include: { team: true }
    });
    
    const leaderboard = results.map(result => {
      const details = JSON.parse(result.details);
      const answers = details.answers || [];
      
      const totalPoints = answers.reduce((sum, answer) => {
        return sum + (parseFloat(answer.points) || 0);
      }, 0);
      
      return {
        teamName: result.team.name,
        totalPoints: Math.round(totalPoints * 100) / 100
      };
    });
    
    leaderboard.sort((a, b) => b.totalPoints - a.totalPoints);
    
    res.json({ leaderboard });
  } catch (error) {
    console.error('Error fetching leaderboard:', error);
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

// Get all session results
app.get('/api/results/all', async (req, res) => {
  try {
    const sessions = await prisma.session.findMany({
      where: {
        status: 'ended'
      },
      include: {
        results: {
          include: {
            team: true
          },
          orderBy: {
            totalPoints: 'desc'
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });
    
    const results = sessions.map(session => ({
      sessionId: session.sessionId,
      name: session.name,
      createdAt: session.createdAt,
      results: session.results.map(result => ({
        team: {
          name: result.team.name
        },
        details: result.details
      }))
    }));
    
    res.json(results);
  } catch (error) {
    console.error('Error fetching all results:', error);
    res.status(500).json({ error: 'Failed to fetch results' });
  }
});

// Save questions
app.post('/api/questions/save', async (req, res) => {
  const { questions, totalPoints, bankName } = req.body;
  
  try {
    if (!bankName || !bankName.trim()) {
      return res.status(400).json({ error: 'A question bank name is required' });
    }
    
    // Create or update question bank
    const bank = await prisma.questionBank.upsert({
      where: { name: bankName },
      create: { name: bankName },
      update: {}
    });
    
    // Validate and create questions
    const createdQuestions = await prisma.$transaction(
      questions.map(q => prisma.question.create({
        data: {
          text: q.text,
          choices: q.choices,
          ...(q.correct ? { correct: q.correct } : {}),
          section: q.section,
          weight: q.weight,
          bank: { connect: { id: bank.id } }
        }
      }))
    );
    
    res.json({
      success: true,
      questions: createdQuestions,
      bankId: bank.id
    });
  } catch (error) {
    console.error('Error saving questions:', error);
    res.status(500).json({ error: 'Failed to save questions' });
  }
});

// Utility functions
function calculateAnswerPoints(question, answerText) {
  if (!question || !question.choices) return 0;
  
  const selectedOption = typeof answerText === 'object' 
    ? question.choices.find(opt => opt.text === answerText.text)
    : question.choices.find(opt => opt.text === answerText);
  
  if (!selectedOption) return 0;
  
  const maxOptionWeight = Math.max(...question.choices.map(o => o.weight || 0));
  return (selectedOption.weight / maxOptionWeight) * (question.weight || 1);
}

async function updateTeamResults(sessionId, teamId) {
  try {
    const session = await prisma.session.findUnique({
      where: { id: sessionId }
    });
    
    const sessionQuestions = await prisma.sessionQuestion.findMany({
      where: { sessionId },
      include: { question: true }
    });
    const questions = sessionQuestions.map(sq => sq.question);
    
    const allFinalAnswers = await prisma.finalAnswer.findMany({
      where: {
        sessionId,
        teamId
      }
    });
    
    let totalPoints = 0;
    const allDetailedAnswers = [];
    
    for (const finalAnswer of allFinalAnswers) {
      const judge = await prisma.judge.findUnique({ where: { id: finalAnswer.judgeId } });
      const answers = JSON.parse(finalAnswer.answers);
      
      for (const answer of answers) {
        const question = questions.find(q => q.id === answer.questionIndex);
        if (question) {
          const points = calculateAnswerPoints(question, answer.answer);
          totalPoints += points;
          
          // Find the selected option to get its weight
          const selectedOption = typeof answer.answer === 'object' 
            ? question.choices.find(opt => opt.text === answer.answer.text)
            : question.choices.find(opt => opt.text === answer.answer);
          
          const optionWeight = selectedOption?.weight || 0;
          const maxOptionWeight = Math.max(...question.choices.map(o => o.weight || 0));
          
          allDetailedAnswers.push({
            questionText: question.text,
            questionWeight: question.weight || 1,
            judgeName: judge?.name || 'Unknown',
            answer: answer.answer,
            points: points,
            optionWeight: optionWeight,
            maxOptionWeight: maxOptionWeight
          });
        }
      }
    }
    
    totalPoints = Math.round(totalPoints * 100) / 100;
    
    await prisma.sessionResult.upsert({
      where: {
        sessionId_teamId: {
          sessionId,
          teamId
        }
      },
      create: {
        sessionId,
        teamId,
        totalPoints,
        details: JSON.stringify({ answers: allDetailedAnswers })
      },
      update: {
        totalPoints,
        details: JSON.stringify({ answers: allDetailedAnswers })
      }
    });
    
    // Create leaderboard update event
    await prisma.sessionEvent.create({
      data: {
        sessionId,
        eventType: 'leaderboard_updated',
        eventData: { teamId, totalPoints }
      }
    });
  } catch (error) {
    console.error('Error updating team results:', error);
  }
}

// Start server
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log('Environment:', process.env.NODE_ENV);
});
