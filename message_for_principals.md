# What I think about school, homework, and AI

*November 24, 2026*

## Why I built this project

I built this system for fun and for a YouTube video: it is entertainment and a statement, not a way to cheat. I will not turn in anything the AI produces.

I am someone who thinks about his actions. I aspire to go to Stanford, and I am not a lowly cheater. And even if this were cheating, which it is not, it would be my decision and my consequences.

With this project I want to show two problems: the school's digital ecosystem and the kind of homework we are given.

## My code of ethics

I have a code I do not break, whatever the circumstances. Everything I do with this project goes through it:

- I do not commit vandalism.
- I do not take actions that affect third parties over a problem that is not theirs.
- I do not overreact, not even in the slightest, against whoever is actually responsible for something.

I do not burn down shops over a problem the owners suffer too. And if this becomes popular, the school can sit down and negotiate with me: I am not an enemy, I am a student with a critique and a proposal.

## Critique 1: the digital ecosystem is slow

iSAMS, the grading platform, is slow, and information is scattered across iSAMS, Classroom, and email. My critique did not stop at complaining: I built the fix.

- A GitHub Actions process copies my grades from iSAMS into a Google Sheet.
- A script reads Classroom: assignments, submissions, and teachers' files.
- An alert tells me when a grade in Classroom does not match the one in iSAMS.
- A dashboard brings everything together in one place.
- A public template lets anyone install it with a ZIP and one command on Mac or Windows.

## Critique 2: homework is repetitive and soulless

A lot of homework is the same procedure repeated many times, with nothing to think about: one example, then several exercises of the same type, one after another.

Research says this format is not the best:

- In an experiment with 54 seventh-grade classes, mixing problem types instead of repeating the same one raised scores on a surprise test from 38% to 61% ([IES, Rohrer et al. 2020](https://ies.ed.gov/funding/grantsearch/details.asp?ID=1790)).
- Students in Finland do about three hours of homework a week, and in PISA 2012 they ranked sixth in the world in reading and 12th in math ([The Hechinger Report](https://hechingerreport.org/?p=19326)).

My point is not that practice is useless. It is that we can practice less, and with better design.

## A teacher I know: AI yes, but explain

I fully agree with teachers using AI to make course materials. What I ask is that, at a minimum, they explain and answer questions, instead of telling students to look at the examples or ask a classmate. In the case I know, that classmate is always me: I end up being more of a teacher than the teacher.

At first I put it as "if they can use AI, so can we." What I actually think is more precise: the problem is not the tool, it is that nobody kept the job of explaining.

Using AI to prepare classes is normal. In the United States, about 60% of teachers used AI for their work in 2024-25, and 33% use it at least monthly to create handouts and activities ([Gallup](https://news.gallup.com/poll/691967/three-teachers-weekly.aspx)).

What I noticed in that teacher's materials:

- Every worksheet uses exactly the same template, and several were generated as a batch.
- They have small inconsistencies that suggest nobody reviewed them together.
- The support students get is videos and answer keys, not a space for questions.

All of this is consistent with material made with AI, but I cannot prove it, and that is not the point. The point is that explaining should not fall on students.

I am leaving out anything that could identify this teacher. Exposing them would be an excessive punishment, and it would break my own rule about not overreacting.

## The students school leaves behind

It is not my case, but I know people who genuinely cannot cope with school. It is not the teacher's fault or theirs: it just does not click for them.

One of those people is the best soccer player I have ever seen, and doors close on him because he is measured with a ruler that is not his. It is judging a fish by its ability to climb trees.

If he uses a tool like this for his homework, he harms no one. Today the problem is carried by students, and that is why it is nobody else's priority.

## My proposal: choose based on your passion

Up to 4th grade of primary school, keep everything as it is: we all need that foundation. After that, each student should be able to focus on what they are passionate about, the way you choose your major at university.

I am very good at math and everything logical, and I am going to study programming. But what use is it to a chef to memorize a formula he will never use again? None.

My proposal:

1. A mandatory common foundation up to 4th grade of primary school.
2. After that, a credit system per subject, like at university.
3. A minimum number of credits in each subject to pass, and more depth in the subjects each student chooses.

## Why I publish everything on GitHub

I publish the whole project for three reasons, and none of them breaks my code:

1. **Transparency.** A cheater does not publish his method with installation instructions. I am not hiding anything.
2. **Portfolio.** It is real work I can show: automation, scripts, a dashboard, and an installer for Mac and Windows.
3. **Getting the problem acknowledged.** I want more students to use it however they like.

Today the problem belongs to students, so it is not a priority. If it becomes a problem for institutions, there will be change, and I am willing to sit down and talk about it.

## Why I use Claude

I use Claude because of Anthropic's ethics. Since August 2026, the text Claude generates carries an invisible watermark ([Anthropic](https://www.anthropic.com/news/claude-text-watermark)). It adds no characters: using a secret key, Claude chooses between nearly equivalent synonyms following a pattern that only that key can detect.

This matters because of students who are wrongly accused. Common detectors guess based on style and get it wrong: seven detectors flagged as AI, on average, 61.3% of 91 essays written by non-native English speakers ([Liang et al., Patterns 2023](https://pmc.ncbi.nlm.nih.gov/articles/PMC10382961/)). A watermark looks for a specific signal instead of guessing.

Its real limits, so I do not exaggerate:

- Detection is in private preview, only for eligible organizations such as regulators, media, researchers, and educational organizations ([Claude Help Center](https://support.claude.com/hc/en-us/articles/16266773-How-Claude-marks-AI-generated-content)).
- It works poorly on short texts and barely shows up in exact answers, like math answers.
- It estimates a probability: it does not prove that a text is human-written, and it does not detect text from other AIs.
- Light editing probably will not remove it; rewriting the whole text will. In a preliminary study, not peer-reviewed, on SynthID (the method it is based on), paraphrasing erased the watermark in 58 of 59 texts ([Tamim and Khan](https://arxiv.org/pdf/2607.16010)).

## What people could say back

These are the best arguments against my position, with their evidence. Where I do not have an answer yet, I say so.

| Argument against | Evidence | My answer |
| --- | --- | --- |
| If students use AI for homework, they learn less. | With almost 1,000 high school students in Turkey, those who used GPT without limits did 48% better while practicing but 17% worse on the exam without AI; those who used a tutor that gave hints did the same as the control group ([Knowledge at Wharton](https://knowledge.wharton.upenn.edu/?p=33254)). | The cost falls on whoever uses it, and it is their decision. I do not turn in what the AI produces. |
| If many students use it, schools will not cut homework: they will add more handwritten exams and detectors. | Over two years, sales of exam booklets rose more than 30% at Texas A&M, nearly 50% at the University of Florida, and about 80% at Berkeley ([Entrepreneur, citing the WSJ](https://www.entrepreneur.com/business-news/college-professors-turn-back-to-blue-books-to-combat-chatgpt/492450)). | Those figures are from universities; my proposal is for school. If the problem reaches the institution, there will be change, and I am willing to negotiate. |
| A teacher using AI is not the same as a student using it: the teacher already knows the subject. | See the section on the teacher. | I agree with them using it. What I ask is that they explain and answer questions. |
| At 14, many students do not know what they will study; a general foundation keeps doors open. | — | A common foundation up to 4th grade of primary school, and after that a minimum number of credits per subject, not zero. |
| Publishing the tool affects third parties: students who do their homework and teachers who did not design the system. | — | Still to answer. |

## Sources

- [A Randomized Controlled Trial of Interleaved Mathematics Practice](https://ies.ed.gov/funding/grantsearch/details.asp?ID=1790): Rohrer, Dedrick, Hartwig, and Cheung, Journal of Educational Psychology, 2020 (IES summary).
- [Homework matters depending upon which country you live in](https://hechingerreport.org/?p=19326): Jill Barshay, The Hechinger Report, January 5, 2015.
- [Three in 10 Teachers Use AI Weekly, Saving Six Weeks a Year](https://news.gallup.com/poll/691967/three-teachers-weekly.aspx): Gallup and the Walton Family Foundation, June 24, 2025.
- [Without Guardrails, Generative AI Can Harm Education](https://knowledge.wharton.upenn.edu/?p=33254): Knowledge at Wharton, August 27, 2024, on Bastani et al. (PNAS, 2025).
- [How Claude's text watermark works](https://www.anthropic.com/news/claude-text-watermark): Anthropic, August 14, 2026.
- [How Claude marks AI-generated content](https://support.claude.com/hc/en-us/articles/16266773-How-Claude-marks-AI-generated-content): Claude Help Center.
- [GPT detectors are biased against non-native English writers](https://pmc.ncbi.nlm.nih.gov/articles/PMC10382961/): Liang et al., Patterns, 2023.
- [AI Watermark Evidence Fails Forensic Readiness](https://arxiv.org/pdf/2607.16010): Tamim and Khan, preprint, not peer-reviewed.
- [College Professors Are Turning to an Old-School Product to Combat AI Cheating](https://www.entrepreneur.com/business-news/college-professors-turn-back-to-blue-books-to-combat-chatgpt/492450): Entrepreneur, May 29, 2025, citing the Wall Street Journal.
- Course files from my Classroom, reviewed on November 24, 2026.
