let express = require("express");
let bcrypt = require("bcrypt");
let jwt = require("jsonwebtoken");
let sqlite3 = require("sqlite3");
let { open } = require("sqlite");
let path = require("path");
let app = express();
app.use(express.json());
const { format } = require("date-fns"); // Import the format function from the date-fns module

let db = null;

let dbpath = path.join(__dirname, "twitterClone.db");

let initializedb = async () => {
  try {
    db = await open({
      filename: dbpath,
      driver: sqlite3.Database,
    });
    app.listen(3000, () => {
      console.log("Server Started");
    });
  } catch (e) {
    console.log(e);
    process.exit(1);
  }
};

initializedb();

let verifylogin = (request, response, next) => {
  let jwtToken = request.headers["authorization"].split(" ")[1];
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "secret", (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.username = payload;
        next();
      }
    });
  }
};

app.post("/register", async (request, response) => {
  try {
    let { username, password, name, gender } = request.body;
    let searchquery = `
    select * from user where username=?`;
    let res = await db.get(searchquery, username);
    if (res !== undefined) {
      response.status(400);
      response.send("User already exists");
    } else {
      if (password.length < 6) {
        response.status(400);
        response.send("Password is too short");
      } else {
        let hashedpassword = await bcrypt.hash(password, 10);
        let query = `
            insert into user (username,password,gender,name) values (?,?,?,?)`;
        let params = [username, hashedpassword, gender, name];
        await db.run(query, params);
        response.status(200);
        response.send("User created successfully");
      }
    }
  } catch (e) {
    console.log(e);
    return;
  }
});

app.post("/login", async (request, response) => {
  let { username, password } = request.body;
  let searchquery = `
    select * from user where username=?`;
  let res = await db.get(searchquery, username);
  if (res === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    let ispasswordcorrect = await bcrypt.compare(password, res.password);
    if (ispasswordcorrect) {
      let jwtToken = jwt.sign(username, "secret");
      response.send({ jwtToken: jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});

app.get("/user/tweets/feed", verifylogin, async (request, response) => {
  let query = `
select user.username,tweet.tweet,tweet.date_time from 
tweet left join user on tweet.user_id=user.user_id 
where user.user_id in 
(select following_user_id from follower where follower_user_id=(select user_id from user where username=?)) order by date_time desc limit 4;`;
  let res = await db.all(query, request.username);
  response.send(res);
});

app.get("/user/following/", verifylogin, async (request, response) => {
  let query = `
    select name from user where user_id in (select following_user_id from follower where follower_user_id=(select user_id from user where username=?));`;
  let res = await db.all(query, request.username);
  response.send(res);
});

app.get("/user/followers/", verifylogin, async (request, response) => {
  let query = `
    select name from user where user_id in (select follower_user_id from follower where following_user_id=(select user_id from user where username=?));`;
  let res = await db.all(query, request.username);
  response.send(res);
});

app.get("/tweets/:tweetId/", verifylogin, async (request, response) => {
  let query1 = `
    select user_id from tweet where tweet_id=?`;
  let query2 = `
    select following_user_id from follower where follower_user_id=(select user_id from user where username=?)`;
  let { tweetId } = request.params;
  let res1 = await db.get(query1, tweetId);
  res1 = res1.user_id;
  let res2 = await db.all(query2, request.username);
  res2 = res2.map((o) => {
    return o.following_user_id;
  });
  if (res2.includes(res1)) {
    let query = `
    select tweet, 
    (select count(*) from like where tweet_id=?) as likes,
    (select count(*) from reply where tweet_id=?) as replies,
    date_time as dateTime from tweet 
    where tweet_id=?;
      `;
    let res = await db.get(query, [tweetId, tweetId, tweetId]);
    response.send(res);
  } else {
    response.status(401);
    response.send("Invalid Request");
  }
});

app.get("/tweets/:tweetId/likes", verifylogin, async (request, response) => {
  let query1 = `
    select user_id from tweet where tweet_id=?`;
  let query2 = `
    select following_user_id from follower where follower_user_id=(select user_id from user where username=?)`;
  let { tweetId } = request.params;
  let res1 = await db.get(query1, tweetId);
  if (res1 !== undefined) {
    res1 = res1.user_id;
  }
  let res2 = await db.all(query2, request.username);
  if (res2 !== undefined) {
    res2 = res2.map((o) => {
      return o.following_user_id;
    });
  }
  if (res2.includes(res1)) {
    let query = `
    select username from user where user_id in (select user_id from like where tweet_id=?);`;
    let res = await db.all(query, tweetId);
    res = res.map((o) => {
      return o.username;
    });
    response.send({ likes: res });
  } else {
    response.status(401);
    response.send("Invalid Request");
  }
});

app.get("/tweets/:tweetId/replies", verifylogin, async (request, response) => {
  let query1 = `
    select user_id from tweet where tweet_id=?`;
  let query2 = `
    select following_user_id from follower where follower_user_id=(select user_id from user where username=?)`;
  let { tweetId } = request.params;
  let res1 = await db.get(query1, tweetId);
  if (res1 !== undefined) {
    res1 = res1.user_id;
  }
  let res2 = await db.all(query2, request.username);
  if (res2 !== undefined) {
    res2 = res2.map((o) => {
      return o.following_user_id;
    });
  }
  if (res2.includes(res1)) {
    let query = `
    select user.name,reply.reply from reply left join user on reply.user_id=user.user_id where reply.tweet_id=?;`;
    let res = await db.all(query, tweetId);
    response.send({ replies: res });
  } else {
    response.status(401);
    response.send("Invalid Request");
  }
});

app.get("/user/tweets/", verifylogin, async (request, response) => {
  let query = `select tweet, 
    (select count(*) from like where user_id=(select user_id from user where username=?)) as likes,
    (select count(*) from reply where user_id=(select user_id from user where username=?)) as replies,
    date_time as dateTime from tweet
    where user_id=(select user_id from user where username=?)`;
  let res = await db.all(query, [
    request.username,
    request.username,
    request.username,
  ]);
  response.send(res);
});

app.post("/user/tweets/", verifylogin, async (request, response) => {
  let query = `
    insert into tweet (tweet,user_id,date_time) values (?,(select user_id from user where username=?),?)`;
  const now = new Date();
  const timestamp = format(now, "yyyy-MM-dd hh:mm:ss");
  await db.run(query, [request.body.tweet, request.username, timestamp]);
  response.send("Created a Tweet");
});

app.delete("/tweets/:tweetId/", verifylogin, async (request, response) => {
  let { tweetId } = request.params;
  let query1 = `select tweet_id from tweet where user_id=(select user_id from user where username=?)`;
  let res1 = await db.all(query1, request.username);
  res1 = res1.map((o) => {
    return o.tweet_id;
  });
  console.log(res1, tweetId);
  if (res1.includes(Number(tweetId))) {
    query = `
      delete from tweet where tweet_id=?`;
    await db.run(query, tweetId);
    response.send("Tweet Removed");
  } else {
    response.status(401);
    response.send("Invalid Request");
  }
});

module.exports = app;
