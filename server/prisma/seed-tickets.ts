// Run with `bun run db:seed:tickets`: adds 100 realistic sample tickets to the dev database.
// Safe to re-run — each ticket has a fixed `messageId`, so existing ones are skipped.
// Statuses, categories, senders and dates are spread out so sorting and filtering have
// something to show. Output is deterministic (seeded PRNG), relative to the current date.
import { prisma } from "../src/db.ts";
import { TicketCategory, TicketStatus } from "../src/generated/prisma/enums.ts";

const { general_question: G, technical_question: T, refund_request: R } = TicketCategory;

// [category (null = not yet classified), subject, body]
const samples: [TicketCategory | null, string, string][] = [
  [T, "Course video stuck at 0% buffering", "Every lecture in Module 3 of the React course just spins forever. Other sites stream fine. I'm on Chrome 129, Windows 11."],
  [T, "Can't log in after password reset", "I reset my password this morning, got the confirmation email, but the login page still says 'invalid credentials'. Tried twice."],
  [R, "Refund for accidental double purchase", "I was charged twice for the Data Science Bootcamp ($199 each) on the same day. Please refund one of the charges."],
  [G, "Do certificates expire?", "Quick question — once I finish a course and get the certificate, is it valid forever or does it need renewing?"],
  [T, "Quiz won't submit on mobile", "On the iOS app the 'Submit' button on the Module 2 quiz does nothing. Works on desktop but I mostly study on my phone."],
  [R, "Requesting refund — course not what I expected", "The Advanced Python course is mostly beginner material. I'm within the 14-day window and would like a refund please."],
  [G, "How do I change the email on my account?", "I'm moving from my university email to a personal one before I graduate. How do I update it without losing progress?"],
  [T, "Certificate PDF is blank", "I completed Intro to SQL and downloaded my certificate, but the PDF opens as a blank white page in every viewer I've tried."],
  [null, "Help!!", "I can't get into anything. Please call me."],
  [G, "Student discount availability", "Do you offer discounts for full-time students? I have a valid .edu email address."],
  [T, "Subtitles out of sync on lecture 14", "The English captions on 'Hooks in depth' lag about 5 seconds behind the audio from the 3-minute mark onwards."],
  [R, "Charged after cancelling subscription", "I cancelled my monthly plan on the 2nd but was billed again on the 5th. I have the cancellation confirmation email."],
  [G, "Can I download lectures for offline viewing?", "I commute on a train with no signal. Is there a way to download videos to watch offline?"],
  [T, "Code playground shows 'Kernel died'", "The embedded Jupyter environment in Lesson 6 restarts with 'Kernel died unexpectedly' whenever I import pandas."],
  [T, "2FA codes not arriving", "I enabled two-factor auth and now SMS codes never arrive. I'm locked out. Phone number ends in 4471."],
  [G, "Is there a group plan for our team?", "We have 12 developers who'd like access to the cloud track. Do you have team pricing or invoicing?"],
  [R, "Refund for annual plan — billed instead of monthly", "I selected the monthly option but was charged $240 for a year. Please refund and switch me to monthly."],
  [null, "Question about my order", "Order #A-88213. Not sure if it went through, nothing in my dashboard."],
  [T, "Progress not saving between sessions", "I watch lessons to the end and they're marked complete, but next day they're back to unwatched. Using Firefox."],
  [G, "When does the next live cohort start?", "I'd like to join the instructor-led UX cohort. When is the next start date and how do I sign up?"],
  [T, "App crashes on launch (Android 14)", "Since the last update the Android app closes immediately on launch. Pixel 7, reinstalling didn't help."],
  [R, "Refund — duplicate account purchase", "I accidentally bought the course on a second account I didn't know I had. Can you refund that one?"],
  [G, "Can I transfer my course to a friend?", "I bought Graphic Design Basics but no longer need it. Can I gift or transfer it to a friend?"],
  [T, "Assignment upload fails at 99%", "Uploading my final project zip (48 MB) gets to 99% then shows 'Upload failed'. The limit says 100 MB."],
  [T, "Dark mode makes code blocks unreadable", "With dark mode on, code snippets in the lesson text are dark grey on black. Hard to read."],
  [G, "Do you provide invoices for expensing?", "My employer reimburses training. Can I get a VAT invoice with our company name for my last purchase?"],
  [R, "Please refund — medical emergency", "I had to withdraw from the cohort for medical reasons. I've attended only one session. Is a refund possible?"],
  [null, "re: your account", "Got an email saying my account was updated but I didn't change anything?"],
  [T, "Videos play with no sound", "All lecture videos play but there's no audio. Other YouTube videos in the same browser have sound."],
  [G, "Prerequisites for Machine Learning track", "What maths background do I need before starting the ML track? I did calculus years ago."],
  [T, "SSO login loop with Google", "Clicking 'Continue with Google' sends me back to the login page in an endless loop. Cleared cookies already."],
  [R, "Coupon didn't apply — refund the difference", "I used code SPRING30 at checkout and it showed the discount, but I was charged full price. Please refund the 30%."],
  [G, "Accessibility: screen reader support?", "I'm visually impaired and use NVDA. Are your course pages and quizzes screen-reader friendly?"],
  [T, "Quiz marks correct answer as wrong", "Question 7 in the Networking quiz: the answer is 255.255.255.0 but it's marked wrong even when I type exactly that."],
  [T, "Notifications email flood", "I'm getting 30+ 'new reply' emails a day from the discussion forum even though I turned notifications off."],
  [G, "How long do I have access after purchase?", "If I buy a single course, is it lifetime access or does it expire after a year?"],
  [R, "Refund request for unused bundle", "I bought the 5-course bundle last week but haven't started any. I'd like a full refund please."],
  [null, "Urgent", "please get back to me asap regarding my account"],
  [T, "Downloaded resources are corrupted", "The 'starter-files.zip' for Lesson 3 of Node.js Fundamentals says 'archive is damaged' on Mac and Windows."],
  [G, "Do you offer financial aid?", "I'm currently unemployed and can't afford the bootcamp. Is there a scholarship or financial aid program?"],
  [T, "Can't change my display name", "Saving a new display name shows a green tick but the old name reappears after refresh."],
  [R, "Charged in USD instead of EUR", "My bank converted a USD charge and I paid extra fees. The checkout showed EUR. Please refund and recharge in EUR."],
  [G, "Is the Kubernetes course up to date?", "The course says it was recorded in 2023. Does it still match current Kubernetes versions?"],
  [T, "Page keeps reloading on Safari", "On Safari 18 the lesson page reloads every ~20 seconds, so I can't finish a video."],
  [T, "API key for lab environment invalid", "The AWS lab in Module 5 gives 'InvalidClientTokenId' using the credentials the lab page provides."],
  [G, "Can I get a certificate in my legal name?", "My profile uses a nickname. Can my certificate show my full legal name for my CV?"],
  [R, "Refund for workshop that was cancelled", "The live 'Portfolio Review' workshop on Saturday was cancelled by the instructor. I paid $49 for it."],
  [null, "Feedback", "Just wanted to say the instructor for Excel Advanced is fantastic. Also, small typo in lesson 4 title."],
  [T, "Keyboard shortcuts stop working in player", "Space and arrow keys don't control the video player anymore after the last update."],
  [G, "Partnering with your platform as an instructor", "I'm a senior data engineer and would love to teach a course. Who should I talk to?"],
  [T, "Forum post deleted without reason", "My question in the JavaScript forum disappeared. Was it removed by a moderator or a bug?"],
  [R, "Refund — billed after free trial I cancelled", "I cancelled during my 7-day trial (screenshot attached) but was charged $29 when it ended."],
  [G, "Difference between Pro and Teams plans?", "What exactly does Teams include that Pro doesn't, besides the admin dashboard?"],
  [T, "Exam timer ran out early", "The final exam is 60 minutes but the timer ended after ~35 minutes and auto-submitted. I'd like a retake."],
  [T, "Can't reset password — link expired instantly", "Every password reset link says 'This link has expired' even when I click it within a minute."],
  [G, "Are courses available in Spanish?", "My team is in Madrid. Do any of your courses have Spanish audio or subtitles?"],
  [R, "Refund request: wrong course purchased", "I meant to buy 'Intro to Statistics' but bought 'Applied Statistics' by mistake. Can I get a refund or swap?"],
  [null, "Account deletion", "Please delete my account and all my data."],
  [T, "Embedded slides not loading", "The slide decks embedded in the Product Management course show 'Refused to connect'."],
  [G, "How do I add the certificate to LinkedIn?", "Is there a direct 'Add to LinkedIn' button, or do I enter the credential ID manually?"],
  [T, "Lesson marked locked though I paid", "Module 4 of the Cybersecurity course shows a lock icon even though I bought the full course."],
  [R, "Refund — course removed from catalog", "The Flutter course I purchased has been removed and I can no longer access it. I'd like my money back."],
  [G, "Can I pause my subscription?", "I'm travelling for two months. Is there a way to pause billing instead of cancelling?"],
  [T, "Search returns no results", "Searching for anything in the course catalog returns 'No results', even 'python'."],
  [T, "Webcam proctoring won't detect camera", "The proctored exam says 'No camera detected', but my webcam works in Zoom and the browser has permission."],
  [G, "Do you have a mobile app for iPad?", "Is there an iPad-optimised app or should I use the browser?"],
  [R, "Refund for tax charged incorrectly", "I'm a business in Ireland with a valid VAT ID, but I was charged 23% VAT. Please refund the tax."],
  [null, "Hello", "Is someone there? Sent three emails already."],
  [T, "Course progress shows 110%", "Not a big deal, but my progress bar for Git Essentials shows 110% complete."],
  [G, "Recommended order for the web dev track", "Should I take HTML/CSS before JavaScript Fundamentals, or can I do them in parallel?"],
  [T, "Captions missing for new lectures", "The three lectures added last week to the Docker course have no captions at all."],
  [R, "Refund — bootcamp schedule changed", "The bootcamp moved from evenings to daytime, which I can't attend due to work. I'd like a refund."],
  [G, "Can I upgrade from monthly to annual mid-cycle?", "Will I be credited for the remaining days of my current month if I switch to annual now?"],
  [T, "Gradebook not showing my scores", "I've completed 6 graded assignments but the gradebook shows all as 'Not submitted'."],
  [T, "Error 502 when opening dashboard", "Since this morning the dashboard shows 'Bad Gateway 502'. Courses page loads fine."],
  [G, "Is there a student community or Discord?", "I'd love to study with others. Do you have an official Discord or Slack?"],
  [R, "Refund — gift purchase never redeemed", "I bought a gift card for my nephew 3 months ago. He never redeemed it. Can I get a refund?"],
  [null, "Invoice", "Need invoice for March please."],
  [T, "Interactive diagram not clickable", "In the Networking course, the OSI model diagram doesn't respond to clicks on Chrome or Edge."],
  [G, "Can I audit a course before buying?", "Is there a preview or free audit option so I can check the teaching style first?"],
  [T, "Merged accounts lost my progress", "Support merged my two accounts last week and now all my progress in AWS Fundamentals is gone."],
  [R, "Requesting partial refund for outage", "The platform was down most of last week during my exam prep period. Is partial credit possible?"],
  [G, "How are instructors vetted?", "Curious how you choose instructors — are they industry practitioners?"],
  [T, "Audio echo in lecture 9", "There's a strong echo in 'Async patterns' lecture 9 of the Node course, almost hard to understand."],
  [T, "Can't remove old payment card", "Trying to delete an expired Visa from my billing settings gives 'Something went wrong'."],
  [G, "Do you offer CPE credits?", "I'm a CPA. Do any of your finance courses count towards CPE credits?"],
  [R, "Refund — child bought course without permission", "My 12-year-old bought three courses using my saved card. Please refund all three."],
  [null, "pls fix", "the thing is broken again"],
  [T, "Time zone wrong on live session invites", "Calendar invites for live sessions show 2 hours later than the actual start time. I'm in Berlin."],
  [G, "What happens to my courses if I cancel Pro?", "If I cancel my Pro subscription, do I keep access to courses I've started?"],
  [T, "Copy button in code snippets broken", "Clicking the 'Copy' icon on code blocks copies nothing to the clipboard."],
  [R, "Refund request — duplicate charge from app store", "I was charged by both Apple and directly on the website for the same subscription this month."],
  [G, "Hiring partners program?", "Do you connect graduates with hiring partners after finishing the bootcamp?"],
  [T, "Unable to play videos on Linux", "Videos fail with 'DRM error' on Firefox on Ubuntu 24.04. Widevine is enabled."],
  [T, "Account shows wrong country", "My account lists my country as the US but I'm in Canada, so prices show in USD."],
  [G, "Can I take the exam without the course?", "I already have experience. Can I just buy and take the certification exam?"],
  [R, "Refund for conference ticket", "I can't attend the virtual summit next month. Is the $89 ticket refundable?"],
  [null, "Thanks!", "The issue with my login was fixed. Thank you so much."],
  [R, "Refund — overcharged for regional pricing", "A colleague in the same city paid 40% less for the identical course yesterday. Can you refund the difference?"],
  [T, "Bookmarks disappeared", "All the lessons I bookmarked are gone from the 'Saved' tab."],
];

const senders: [string | null, string][] = [
  ["Sam Patel", "sam.patel@gmail.com"],
  ["Maria García", "maria.garcia@outlook.es"],
  ["Liam O'Connor", "liam.oconnor@ucd.ie"],
  ["Aisha Bello", "aisha.bello@yahoo.com"],
  [null, "jdoe1987@hotmail.com"],
  ["Chen Wei", "chen.wei@protonmail.com"],
  ["Olivia Smith", "olivia.smith@stanford.edu"],
  ["Noah Müller", "noah.mueller@web.de"],
  ["Priya Sharma", "priya.sharma@infosys.com"],
  [null, "student2049@icloud.com"],
  ["Emma Johansson", "emma.j@telia.se"],
  ["Diego Rossi", "diego.rossi@libero.it"],
  ["Fatima Khan", "fatima.khan@gmail.com"],
  ["Tom Becker", "tom@beckerconsulting.de"],
  ["Yuki Tanaka", "yuki.tanaka@docomo.ne.jp"],
  [null, "billing@acme-corp.com"],
  ["Grace Okafor", "grace.okafor@unilag.edu.ng"],
  ["Lucas Silva", "lucas.silva@uol.com.br"],
  ["Hannah Lee", "hannah.lee@kaist.ac.kr"],
  ["Ben Carter", "ben.carter@gmail.com"],
  ["Zoe Dubois", "zoe.dubois@orange.fr"],
  [null, "throwaway.learner@gmail.com"],
  ["Ahmed Hassan", "ahmed.hassan@outlook.com"],
  ["Sofia Nowak", "sofia.nowak@wp.pl"],
  ["Jack Thompson", "jack.t@bigpond.com.au"],
];

// Deterministic PRNG (mulberry32) so re-seeding a fresh DB gives the same data.
let state = 20261010;
function random() {
  state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = <T>(items: readonly T[]) => items[Math.floor(random() * items.length)]!;

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();

const data = samples.map(([category, subject, body], i) => {
  const [fromName, fromEmail] = pick(senders);
  // Spread over the last 90 days, with more recent tickets more likely still open.
  const ageDays = random() * 90;
  const roll = random();
  const status =
    ageDays < 7
      ? roll < 0.8 ? TicketStatus.open : TicketStatus.resolved
      : ageDays < 30
        ? roll < 0.45 ? TicketStatus.open : roll < 0.85 ? TicketStatus.resolved : TicketStatus.closed
        : roll < 0.15 ? TicketStatus.open : roll < 0.6 ? TicketStatus.resolved : TicketStatus.closed;
  const createdAt = new Date(now - ageDays * DAY);
  return {
    subject,
    body,
    fromEmail,
    fromName,
    status,
    category,
    createdAt,
    // No replies are seeded, so every sender is still waiting since they wrote.
    awaitingReplySince: createdAt,
    messageId: `<seed-ticket-${String(i + 1).padStart(3, "0")}@example.com>`,
  };
});

const { count } = await prisma.ticket.createMany({ data, skipDuplicates: true });
console.log(`Created ${count} sample tickets (${data.length - count} already existed)`);

await prisma.$disconnect();
