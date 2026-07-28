CREATE DATABASE IF NOT EXISTS speaksense_ai;
USE speaksense_ai;

CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    register_number VARCHAR(20) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('student', 'admin') NOT NULL DEFAULT 'student',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS student_profile (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL UNIQUE,
    department VARCHAR(100),
    year VARCHAR(30),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS interview_questions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    question_text TEXT NOT NULL,
    category VARCHAR(100) NOT NULL DEFAULT 'general',
    difficulty ENUM('easy', 'medium', 'hard') NOT NULL DEFAULT 'medium',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS interview_session (
    id INT AUTO_INCREMENT PRIMARY KEY,
    student_id INT NOT NULL,
    title VARCHAR(150) NOT NULL,
    status ENUM('in_progress','completed','cancelled') NOT NULL DEFAULT 'in_progress',
    total_score DECIMAL(5,2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP NULL,
    FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS interview_response (
    id INT AUTO_INCREMENT PRIMARY KEY,
    session_id INT NOT NULL,
    question_id INT NOT NULL,
    audio_path VARCHAR(500),
    transcript TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES interview_session(id) ON DELETE CASCADE,
    FOREIGN KEY (question_id) REFERENCES interview_questions(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS ai_analysis (
    id INT AUTO_INCREMENT PRIMARY KEY,
    response_id INT NOT NULL UNIQUE,
    grammar_score DECIMAL(5,2) NOT NULL,
    pronunciation_score DECIMAL(5,2) NOT NULL,
    fluency_score DECIMAL(5,2) NOT NULL,
    confidence_score DECIMAL(5,2) NOT NULL,
    vocabulary_score DECIMAL(5,2) NOT NULL,
    emotion VARCHAR(50) NOT NULL,
    overall_score DECIMAL(5,2) NOT NULL,
    feedback TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (response_id) REFERENCES interview_response(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS reports (
    id INT AUTO_INCREMENT PRIMARY KEY,
    session_id INT NOT NULL UNIQUE,
    report_path VARCHAR(500) NOT NULL,
    summary TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES interview_session(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS progress (
    id INT AUTO_INCREMENT PRIMARY KEY,
    student_id INT NOT NULL UNIQUE,
    average_score DECIMAL(5,2) NOT NULL DEFAULT 0,
    interviews_completed INT NOT NULL DEFAULT 0,
    total_credits DECIMAL(7,2) NOT NULL DEFAULT 0,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE
);

-- GD Topics (pool)
CREATE TABLE IF NOT EXISTS gd_topics (
    id INT AUTO_INCREMENT PRIMARY KEY,
    topic TEXT NOT NULL,
    category VARCHAR(100) DEFAULT 'general',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- GD Sessions with 12-char random session_code
CREATE TABLE IF NOT EXISTS gd_sessions (
    session_code VARCHAR(12) PRIMARY KEY,
    topic_id INT NOT NULL,
    status ENUM('waiting', 'preparation', 'speaking', 'completed') NOT NULL DEFAULT 'waiting',
    team_size INT NOT NULL DEFAULT 2,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP NULL,
    FOREIGN KEY (topic_id) REFERENCES gd_topics(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS gd_team_members (
    id INT AUTO_INCREMENT PRIMARY KEY,
    session_code VARCHAR(12) NOT NULL,
    user_id INT NOT NULL,
    team_number INT NOT NULL DEFAULT 1,
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_code) REFERENCES gd_sessions(session_code) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS gd_invitations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    session_code VARCHAR(12) NOT NULL,
    from_user_id INT NOT NULL,
    to_user_id INT NOT NULL,
    status ENUM('pending', 'accepted', 'declined') NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_code) REFERENCES gd_sessions(session_code) ON DELETE CASCADE,
    FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (to_user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY (session_code, to_user_id)
);

CREATE TABLE IF NOT EXISTS gd_evaluation (
    id INT AUTO_INCREMENT PRIMARY KEY,
    session_code VARCHAR(12) NOT NULL,
    user_id INT NOT NULL,
    fluency_score DECIMAL(5,2) NOT NULL DEFAULT 0,
    grammar_score DECIMAL(5,2) NOT NULL DEFAULT 0,
    accent_score DECIMAL(5,2) NOT NULL DEFAULT 0,
    relevance_score DECIMAL(5,2) NOT NULL DEFAULT 0,
    content_quality_score DECIMAL(5,2) NOT NULL DEFAULT 0,
    overall_score DECIMAL(5,2) NOT NULL DEFAULT 0,
    transcript TEXT,
    credential_points DECIMAL(5,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_code) REFERENCES gd_sessions(session_code) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS gd_leaderboard (
    id INT AUTO_INCREMENT PRIMARY KEY,
    session_code VARCHAR(12) NOT NULL,
    user_id INT NOT NULL,
    rank_position INT NOT NULL,
    overall_score DECIMAL(5,2) NOT NULL,
    credential_points DECIMAL(5,2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_code) REFERENCES gd_sessions(session_code) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Track topic refreshes per user (max 3)
CREATE TABLE IF NOT EXISTS gd_topic_refreshes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    refresh_count INT NOT NULL DEFAULT 0,
    seen_topic_ids TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY (user_id)
);

INSERT IGNORE INTO gd_topics (id, topic, category) VALUES
(1, 'My College', 'college'),
(2, 'My Best Friend', 'personal'),
(3, 'My Family', 'personal'),
(4, 'My Favorite Lecturer', 'favorites'),
(5, 'My Favorite Subject', 'favorites'),
(6, 'My Favorite Food', 'favorites'),
(7, 'My Favorite Game', 'favorites'),
(8, 'My Favorite Sport', 'favorites'),
(9, 'My Favorite Movie', 'favorites'),
(10, 'My Favorite Place', 'favorites'),
(11, 'My Favorite Festival', 'favorites'),
(12, 'My Favorite Season', 'favorites'),
(13, 'My Favorite Hobby', 'favorites'),
(14, 'My Favorite Mobile App', 'favorites'),
(15, 'My Favorite Social Media App', 'favorites'),
(16, 'College Life', 'college'),
(17, 'First Day at College', 'college'),
(18, 'College Friends', 'college'),
(19, 'College Classroom', 'college'),
(20, 'College Canteen', 'college'),
(21, 'College Library', 'college'),
(22, 'College Bus', 'college'),
(23, 'College Uniform', 'college'),
(24, 'College Events', 'college'),
(25, 'College Functions', 'college'),
(26, 'College Holidays', 'college'),
(27, 'College Tour', 'college'),
(28, 'College Hostel', 'college'),
(29, 'College Attendance', 'college'),
(30, 'College Exams', 'college'),
(31, 'Assignments', 'academics'),
(32, 'Semester Exams', 'academics'),
(33, 'Online Classes', 'academics'),
(34, 'Practical Classes', 'academics'),
(35, 'Group Projects', 'academics'),
(36, 'Reading Books', 'academics'),
(37, 'Communication Skills', 'skills'),
(38, 'English Speaking', 'skills'),
(39, 'Learning New Skills', 'skills'),
(40, 'Time Management', 'skills'),
(41, 'Mobile Phones', 'technology'),
(42, 'Internet', 'technology'),
(43, 'YouTube', 'technology'),
(44, 'Social Media', 'technology'),
(45, 'Instagram', 'technology'),
(46, 'WhatsApp', 'technology'),
(47, 'Online Games', 'technology'),
(48, 'Video Games', 'technology'),
(49, 'Artificial Intelligence', 'technology'),
(50, 'ChatGPT', 'technology'),
(51, 'Computers', 'technology'),
(52, 'Online Shopping', 'technology'),
(53, 'Online Learning', 'technology'),
(54, 'Digital Payments', 'technology'),
(55, 'Mobile Banking', 'technology'),
(56, 'Watching Movies', 'entertainment'),
(57, 'Listening to Music', 'entertainment'),
(58, 'Playing Cricket', 'sports'),
(59, 'Playing Football', 'sports'),
(60, 'Indoor Games', 'sports'),
(61, 'Outdoor Games', 'sports'),
(62, 'Exercise', 'health'),
(63, 'Healthy Food', 'health'),
(64, 'Junk Food', 'health'),
(65, 'Good Sleep', 'health'),
(66, 'Morning Routine', 'daily_life'),
(67, 'Good Habits', 'daily_life'),
(68, 'Cleanliness', 'daily_life'),
(69, 'Friendship', 'values'),
(70, 'Teamwork', 'values'),
(71, 'Helping Others', 'values'),
(72, 'Being Honest', 'values'),
(73, 'Being Kind', 'values'),
(74, 'Discipline', 'values'),
(75, 'Hard Work', 'values'),
(76, 'Confidence', 'values'),
(77, 'Leadership', 'values'),
(78, 'Success', 'values'),
(79, 'Failure', 'values'),
(80, 'Saving Money', 'finance'),
(81, 'Trees', 'environment'),
(82, 'Nature', 'environment'),
(83, 'Rain', 'environment'),
(84, 'Pollution', 'environment'),
(85, 'Saving Water', 'environment'),
(86, 'Saving Electricity', 'environment'),
(87, 'Planting Trees', 'environment'),
(88, 'Keeping Our College Clean', 'environment'),
(89, 'Public Transport', 'society'),
(90, 'City Life', 'society'),
(91, 'Village Life', 'society'),
(92, 'A Day Without a Mobile Phone', 'reflection'),
(93, 'A Day Without Internet', 'reflection'),
(94, 'Work From Home', 'career'),
(95, 'Part-Time Jobs for Students', 'career'),
(96, 'Internship', 'career'),
(97, 'My Dream Job', 'career'),
(98, 'My Career Goal', 'career'),
(99, 'Campus Placement', 'career'),
(100, 'How Can We Make Our College Better?', 'college');

-- Solo Practice Sessions
CREATE TABLE IF NOT EXISTS solo_practice_sessions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    topic TEXT NOT NULL,
    status ENUM('preparation', 'speaking', 'completed') NOT NULL DEFAULT 'preparation',
    transcript TEXT,
    overall_score DECIMAL(5,2),
    fluency_score DECIMAL(5,2),
    grammar_score DECIMAL(5,2),
    accent_score DECIMAL(5,2),
    delivery_score DECIMAL(5,2),
    weaknesses TEXT,
    improvement_tips TEXT,
    session_number INT NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS solo_practice_usage (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL UNIQUE,
    total_sessions INT NOT NULL DEFAULT 0,
    seen_quote_ids TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS motivational_quotes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    quote TEXT NOT NULL,
    author VARCHAR(100) NOT NULL DEFAULT 'Unknown'
);

INSERT IGNORE INTO motivational_quotes (id, quote, author) VALUES
(1, 'The only way to do great work is to love what you do.', 'Steve Jobs'),
(2, 'Believe you can and you are halfway there.', 'Theodore Roosevelt'),
(3, 'Your limitation—it is only your imagination.', 'Unknown'),
(4, 'Push yourself because no one else is going to do it for you.', 'Unknown'),
(5, 'Great things never come from comfort zones.', 'Unknown'),
(6, 'Dream it. Wish it. Do it.', 'Unknown'),
(7, 'Success is not final, failure is not fatal: it is the courage to continue that counts.', 'Winston Churchill'),
(8, 'The future depends on what you do today.', 'Mahatma Gandhi'),
(9, 'It always seems impossible until it is done.', 'Nelson Mandela'),
(10, 'You are braver than you believe, stronger than you seem, and smarter than you think.', 'A.A. Milne'),
(11, 'The only person you are destined to become is the person you decide to be.', 'Ralph Waldo Emerson'),
(12, 'Everything you have ever wanted is on the other side of fear.', 'George Addair'),
(13, 'Success usually comes to those who are too busy to be looking for it.', 'Henry David Thoreau'),
(14, 'Don’t watch the clock; do what it does. Keep going.', 'Sam Levenson'),
(15, 'The secret of getting ahead is getting started.', 'Mark Twain'),
(16, 'You miss 100% of the shots you don\'t take.', 'Wayne Gretzky'),
(17, 'Act as if what you do makes a difference. It does.', 'William James'),
(18, 'What lies behind us and what lies before us are tiny matters compared to what lies within us.', 'Ralph Waldo Emerson'),
(19, 'The best time to plant a tree was 20 years ago. The second best time is now.', 'Chinese Proverb'),
(20, 'Hardships often prepare ordinary people for an extraordinary destiny.', 'C.S. Lewis'),
(21, 'Believe in yourself and all that you are. Know that there is something inside you that is greater than any obstacle.', 'Christian D. Larson'),
(22, 'The mind is everything. What you think you become.', 'Buddha'),
(23, 'Strive not to be a success, but rather to be of value.', 'Albert Einstein'),
(24, 'Do what you can, with what you have, where you are.', 'Theodore Roosevelt'),
(25, 'The only impossible journey is the one you never begin.', 'Tony Robbins');

-- Discussion topics for GD Live (basic debate/opinion topics)
CREATE TABLE IF NOT EXISTS gd_easy_topics (
    id INT AUTO_INCREMENT PRIMARY KEY,
    topic VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT IGNORE INTO gd_easy_topics (id, topic) VALUES
(1, 'My College'),
(2, 'My Best Friend'),
(3, 'My Family'),
(4, 'My Favorite Lecturer'),
(5, 'My Favorite Subject'),
(6, 'My Favorite Food'),
(7, 'My Favorite Game'),
(8, 'My Favorite Sport'),
(9, 'My Favorite Movie'),
(10, 'My Favorite Place'),
(11, 'My Favorite Festival'),
(12, 'My Favorite Season'),
(13, 'My Favorite Hobby'),
(14, 'My Favorite Mobile App'),
(15, 'My Favorite Social Media App'),
(16, 'College Life'),
(17, 'First Day at College'),
(18, 'College Friends'),
(19, 'College Classroom'),
(20, 'College Canteen'),
(21, 'College Library'),
(22, 'College Bus'),
(23, 'College Uniform'),
(24, 'College Events'),
(25, 'College Functions'),
(26, 'College Holidays'),
(27, 'College Tour'),
(28, 'College Hostel'),
(29, 'College Attendance'),
(30, 'College Exams'),
(31, 'Assignments'),
(32, 'Semester Exams'),
(33, 'Online Classes'),
(34, 'Practical Classes'),
(35, 'Group Projects'),
(36, 'Reading Books'),
(37, 'Communication Skills'),
(38, 'English Speaking'),
(39, 'Learning New Skills'),
(40, 'Time Management'),
(41, 'Mobile Phones'),
(42, 'Internet'),
(43, 'YouTube'),
(44, 'Social Media'),
(45, 'Instagram'),
(46, 'WhatsApp'),
(47, 'Online Games'),
(48, 'Video Games'),
(49, 'Artificial Intelligence'),
(50, 'ChatGPT'),
(51, 'Computers'),
(52, 'Online Shopping'),
(53, 'Online Learning'),
(54, 'Digital Payments'),
(55, 'Mobile Banking'),
(56, 'Watching Movies'),
(57, 'Listening to Music'),
(58, 'Playing Cricket'),
(59, 'Playing Football'),
(60, 'Indoor Games'),
(61, 'Outdoor Games'),
(62, 'Exercise'),
(63, 'Healthy Food'),
(64, 'Junk Food'),
(65, 'Good Sleep'),
(66, 'Morning Routine'),
(67, 'Good Habits'),
(68, 'Cleanliness'),
(69, 'Friendship'),
(70, 'Teamwork'),
(71, 'Helping Others'),
(72, 'Being Honest'),
(73, 'Being Kind'),
(74, 'Discipline'),
(75, 'Hard Work'),
(76, 'Confidence'),
(77, 'Leadership'),
(78, 'Success'),
(79, 'Failure'),
(80, 'Saving Money'),
(81, 'Trees'),
(82, 'Nature'),
(83, 'Rain'),
(84, 'Pollution'),
(85, 'Saving Water'),
(86, 'Saving Electricity'),
(87, 'Planting Trees'),
(88, 'Keeping Our College Clean'),
(89, 'Public Transport'),
(90, 'City Life'),
(91, 'Village Life'),
(92, 'A Day Without a Mobile Phone'),
(93, 'A Day Without Internet'),
(94, 'Work From Home'),
(95, 'Part-Time Jobs for Students'),
(96, 'Internship'),
(97, 'My Dream Job'),
(98, 'My Career Goal'),
(99, 'Campus Placement'),
(100, 'How Can We Make Our College Better?');

-- Anonymous GD Live sessions (4-digit code)
CREATE TABLE IF NOT EXISTS gd_live_sessions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    session_code VARCHAR(4) NOT NULL UNIQUE,
    status ENUM('waiting', 'active', 'completed') NOT NULL DEFAULT 'waiting',
    total_participants INT NOT NULL DEFAULT 0,
    created_by INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(id)
);

-- Teams within a live session
CREATE TABLE IF NOT EXISTS gd_live_teams (
    id INT AUTO_INCREMENT PRIMARY KEY,
    session_code VARCHAR(4) NOT NULL,
    team_number INT NOT NULL,
    topic VARCHAR(255) NOT NULL,
    status ENUM('waiting', 'active', 'completed') NOT NULL DEFAULT 'waiting',
    FOREIGN KEY (session_code) REFERENCES gd_live_sessions(session_code) ON DELETE CASCADE
);

-- Participants in live sessions (anonymous to each other)
CREATE TABLE IF NOT EXISTS gd_live_participants (
    id INT AUTO_INCREMENT PRIMARY KEY,
    session_code VARCHAR(4) NOT NULL,
    user_id INT NOT NULL,
    team_number INT,
    anonymous_label VARCHAR(20),
    transcript TEXT,
    status ENUM('joined', 'assigned', 'completed') NOT NULL DEFAULT 'joined',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY (session_code, user_id),
    FOREIGN KEY (session_code) REFERENCES gd_live_sessions(session_code) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- AI evaluations for GD Live participants
CREATE TABLE IF NOT EXISTS gd_live_evaluations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    session_code VARCHAR(4) NOT NULL,
    user_id INT NOT NULL,
    team_number INT NOT NULL,
    transcript TEXT NOT NULL,
    overall_score FLOAT DEFAULT 0,
    fluency_score FLOAT DEFAULT 0,
    grammar_score FLOAT DEFAULT 0,
    accent_score FLOAT DEFAULT 0,
    relevance_score FLOAT DEFAULT 0,
    content_quality FLOAT DEFAULT 0,
    credential_points FLOAT DEFAULT 0,
    weaknesses TEXT,
    improvement_tips TEXT,
    evaluated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_code) REFERENCES gd_live_sessions(session_code) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE KEY (session_code, user_id)
);

-- Students are seeded via backend/seed.py with proper bcrypt hashes
