// Syllabus parser test cases. TODAY on the server is 2026-11-18.
// expect: items that must come back (date + a word that must be in the title).
// never: words that must NOT appear in any returned title (TBD, cancelled, no-due items).
var CASES = [
{ name: "Clean list, year given", text: `PHIL 210 Ethics - Spring 2027
Assignments
- Response Paper 1 due Monday, January 25, 2027 by 11:59 PM
- Response Paper 2 due Feb. 8, 2027
- Midterm Exam: March 3, 2027 in class
- Final Paper due May 7, 2027 at noon`,
  expect: [["2027-01-25","paper 1"],["2027-02-08","paper 2"],["2027-03-03","midterm"],["2027-05-07","final"]], classHas: "ethic" },

{ name: "Numeric US dates", text: `CHEM 101 General Chemistry, Spring 2027
Lab Report 1 ...... 2/12
Lab Report 2 ...... 2/26
Exam 1 ............ 3/4
Lab Report 3 ...... 4/9
Final Exam ........ 5/11/27`,
  expect: [["2027-02-12","1"],["2027-02-26","2"],["2027-03-04","exam"],["2027-04-09","3"],["2027-05-11","final"]] },

{ name: "Table from a PDF (columns)", text: `HIST 330 Modern Europe   Fall 2026
Week  Date     Topic                         Due
1     Aug 24   Introduction                  -
2     Aug 31   Revolutions of 1848           Map quiz
3     Sep 7    NO CLASS - Labor Day
4     Sep 14   Unification                   Primary source analysis
5     Sep 21   Imperialism                   -
6     Sep 28   Review                        Midterm exam`,
  expect: [["2026-08-31","quiz"],["2026-09-14","source"],["2026-09-28","midterm"]], never: ["labor","introduction","imperialism"] },

{ name: "Week numbers only", text: `PSYC 100 Intro to Psychology
Spring 2027. Classes begin Monday, January 11, 2027. We meet Mondays and Wednesdays.
Week 3 (Wednesday): Quiz 1
Week 6 (Monday): Essay 1 due
Week 9 (Wednesday): Midterm`,
  expect: [["2027-01-27","quiz"],["2027-02-15","essay"],["2027-03-10","midterm"]] },

{ name: "No year, spring term", text: `ART 120 Drawing I - Spring Semester
Sketchbook check: Feb 3
Portfolio review 1: March 10
Final critique: April 28`,
  expect: [["2027-02-03","sketch"],["2027-03-10","portfolio"],["2027-04-28","critique"]] },

{ name: "TBD and announced-later dates", text: `ECON 201 Microeconomics Fall 2026
Problem Set 5 - due Dec 2, 2026
Midterm 2 - date TBD
Group presentation - to be announced in class
Final exam - Dec 14, 2026, 8:00 AM`,
  expect: [["2026-12-02","problem set"],["2026-12-14","final"]], never: ["midterm 2","presentation"] },

{ name: "Rescheduled and cancelled", text: `ENGL 205 Fall 2026 - Schedule
Essay 2 due Oct 1. **UPDATE (Sept 20): Essay 2 is moved to Oct 8.**
Quiz 3 on Nov 12 - CANCELLED
Essay 3 due Nov 19 (was Nov 17)
Portfolio due Dec 10`,
  expect: [["2026-10-08","essay 2"],["2026-11-19","essay 3"],["2026-12-10","portfolio"]], never: ["quiz 3"], neverDates: ["2026-10-01","2026-11-17","2026-11-12"] },

{ name: "Two courses in one paste", text: `=== BIO 150 Cell Biology, Spring 2027 ===
Lab 1 writeup due Jan 22, 2027
Exam 1 Feb 19, 2027

=== MATH 221 Calculus II, Spring 2027 ===
Homework 1 due Jan 20, 2027
Exam 1 Feb 24, 2027`,
  expect: [["2027-01-22","lab"],["2027-02-19","exam"],["2027-01-20","homework"],["2027-02-24","exam"]], twoClasses: true },

{ name: "Scanned-style OCR noise", text: `COMM 1O1 Public Speaking  Fa11 2O26
Speech l (Informative) ..... 0ct. 2l
Speech 2 (Persuasive) ...... Nov. l6
Fina1 Speech ............... Dec. 9`,
  expect: [["2026-10-21","1"],["2026-11-16","2"],["2026-12-09","final"]] },

{ name: "Day-first dates (international)", text: `Module: Marketing Principles (Semester 2, 2027)
Coursework 1 deadline: 15/03/2027
Coursework 2 deadline: 26/04/2027
Exam: 20/05/2027`,
  expect: [["2027-03-15","1"],["2027-04-26","2"],["2027-05-20","exam"]] },

{ name: "Every Friday range", text: `SOC 110 Spring 2027
Weekly reading reflections are due every Friday from Jan 15 through Feb 5, 2027.`,
  expect: [["2027-01-15","reflection"],["2027-01-22","reflection"],["2027-01-29","reflection"],["2027-02-05","reflection"]] },

{ name: "Readings and holidays mixed in", text: `PHIL 101 Fall 2026 calendar
Nov 23 - Read Kant, Groundwork ch. 1 (nothing due)
Nov 26 - No class, Thanksgiving
Nov 30 - Reading quiz on Kant
Dec 3 - Read Mill, Utilitarianism ch. 2
Dec 7 - Short paper due`,
  expect: [["2026-11-30","quiz"],["2026-12-07","paper"]], never: ["thanksgiving","groundwork","utilitarianism"] },

{ name: "Fall term, final in January", text: `LAW 500 Contracts - Fall 2026
Memo 3 due December 4
Take-home final due January 6`,
  expect: [["2026-12-04","memo"],["2027-01-06","final"]] },

{ name: "Times and wordy dates", text: `CS 240 Data Structures, Spring 2027
Project 1 is due on the 5th of February by midnight.
Project 2 is due Thursday the 4th of March, before class.
Project 3: due 2027-04-15 23:59`,
  expect: [["2027-02-05","project 1"],["2027-03-04","project 2"],["2027-04-15","project 3"]] },

{ name: "Long policy text, schedule at the end", text: `MUS 140 Music Theory - Fall 2026
Attendance policy: ` + "Students are expected to attend every class. Absences must be documented. ".repeat(40) + `
Late work: assignments lose 10% per day. Do not email the professor about extensions after Nov 1, 2026.
Office hours: Tuesdays 2-4pm, starting Aug 25.
SCHEDULE
Dec 1: Harmony worksheet 6 due
Dec 8: Composition project due`,
  expect: [["2026-12-01","worksheet"],["2026-12-08","composition"]], never: ["office","late","extension"] },
];
if (typeof module !== "undefined") module.exports = CASES;
