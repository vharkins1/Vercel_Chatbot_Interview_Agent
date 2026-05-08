INSERT INTO "Topic" ("id", "name", "displayOrder") VALUES
	('ATTITUDES',   'Attitudes',   1),
	('TASTES',      'Tastes',      2),
	('WORK',        'Work',        3),
	('PERSONALITY', 'Personality', 4),
	('BODY',        'Body',        5)
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "Question" ("topicId", "text") VALUES
	('ATTITUDES', 'What are your views on the present government — the president, government, policies?'),
	('ATTITUDES', 'What are your views on socialism?'),
	('ATTITUDES', 'What are your views on the question of DEI in schools, work, and government?'),
	('ATTITUDES', 'What are your personal views on drinking?'),
	('ATTITUDES', 'What are your personal standards of beauty and attractiveness in women and men — what do you consider to be attractive in a woman or man?'),
	('ATTITUDES', 'How do you feel about how parents ought to deal with children?'),
	('ATTITUDES', 'What do you think and feel about religion; what are your personal religious views?'),
	('ATTITUDES', 'What are your personal views on sexual morality — how do you feel that you and others should behave in sexual matters?')
ON CONFLICT ("topicId","text") DO NOTHING;
--> statement-breakpoint
INSERT INTO "Question" ("topicId", "text") VALUES
	('TASTES', 'What are your favorite beverages, and which ones do you not like?'),
	('TASTES', 'What are your favorite foods, the ways you like food prepared, and your food dislikes?'),
	('TASTES', 'What are your likes and dislikes in music?'),
	('TASTES', 'What is your favorite reading matter?'),
	('TASTES', 'What kinds of movies do you like to see best, and what TV shows are your favorites?'),
	('TASTES', 'What are your tastes in clothing?'),
	('TASTES', 'What style of house, and what kinds of furnishings, do you like best?'),
	('TASTES', 'What are your favorite ways of spending spare time, e.g., hunting, reading, cards, sports events, parties, dancing, etc.?'),
	('TASTES', 'What kind of party, or social gathering, do you like best, and what kind would bore you, or that you wouldn''t enjoy?'),
	('TASTES', 'What would you appreciate most for a present?')
ON CONFLICT ("topicId","text") DO NOTHING;
--> statement-breakpoint
INSERT INTO "Question" ("topicId", "text") VALUES
	('WORK', 'What do you enjoy most, and get the most satisfaction from, in your present work?'),
	('WORK', 'What do you find to be the most boring and unenjoyable aspects of your work?'),
	('WORK', 'What are your ambitions and goals in your work?'),
	('WORK', 'How do you feel about the salary or rewards that you get for your work?'),
	('WORK', 'What do you find to be the worst pressures and strains in your work?'),
	('WORK', 'How do you feel that your work is appreciated by others (e.g., boss, fellow-workers, teacher, husband, etc.)?'),
	('WORK', 'How do you feel about the choice of career that you have made — are you satisfied with it or not?'),
	('WORK', 'How do you really feel about the people that you work for, or work with?'),
	('WORK', 'What do you feel are your shortcomings and handicaps that prevent you from working as you''d like to, or that prevent you from getting further ahead in your work?')
ON CONFLICT ("topicId","text") DO NOTHING;
--> statement-breakpoint
INSERT INTO "Question" ("topicId", "text") VALUES
	('PERSONALITY', 'What kinds of things make you especially proud of yourself, elated, full of self-esteem or self-respect?'),
	('PERSONALITY', 'What kinds of things make you just furious?'),
	('PERSONALITY', 'What does it take to get you real worried, anxious, and afraid?'),
	('PERSONALITY', 'What does it take to hurt your feelings deeply?'),
	('PERSONALITY', 'What does it take to get you feeling really depressed or blue?'),
	('PERSONALITY', 'What feelings, if any, do you have trouble expressing or controlling?'),
	('PERSONALITY', 'What aspects of your personality do you dislike, worry about, or regard as a handicap to you?'),
	('PERSONALITY', 'Do you feel that you are attractive to the opposite sex or not; and what problems, if any, do you have about getting favorable attention from the opposite sex?'),
	('PERSONALITY', 'What things in the past or present do you feel ashamed and guilty about?'),
	('PERSONALITY', 'What are the facts of your present sex life — including knowledge of how you get sexual gratification; any problems that you might have; with whom you have relations, if anybody?')
ON CONFLICT ("topicId","text") DO NOTHING;
--> statement-breakpoint
INSERT INTO "Question" ("topicId", "text") VALUES
	('BODY', 'What are your present physical measurements, e.g., height, weight, waist, etc.?'),
	('BODY', 'Do you now make special effort to keep fit, healthy, and attractive, e.g., working out, diet, or not?'),
	('BODY', 'What is your past record of illness and treatment?'),
	('BODY', 'What are your feelings about the appearance of your face — things you don''t like, and things that you might like about your face and head — nose, eyes, hair, teeth, etc.?'),
	('BODY', 'What are your feelings about different parts of your body — legs, hips, waist, weight, etc.?'),
	('BODY', 'What problems and worries have you had with your appearance in the past?'),
	('BODY', 'How do you wish you looked: what are your ideals for overall appearance?'),
	('BODY', 'Do you have any long-range worries or concerns about your health, e.g., cancer, ulcers, heart trouble, or not?'),
	('BODY', 'What are your feelings about your adequacy in sexual behavior — do you feel able to perform adequately in sex-relationships or not?')
ON CONFLICT ("topicId","text") DO NOTHING;
