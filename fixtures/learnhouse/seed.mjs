const baseUrl = process.argv[2];
if (!baseUrl || !/^http:\/\/127\.0\.0\.1:\d+$/.test(baseUrl)) {
  throw new Error('usage: node seed.mjs http://127.0.0.1:PORT');
}

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    throw new Error(`${options.method || 'GET'} ${path} -> ${response.status}: ${text}`);
  }
  return body;
}

const login = await request('/api/v1/auth/login', {
  method: 'POST',
  headers: {'content-type': 'application/x-www-form-urlencoded'},
  body: new URLSearchParams({
    username: 'admin@webmcp-eval.com',
    password: 'WebmcpEvalAdmin!234',
  }),
});
const token = login?.tokens?.access_token || login?.access_token;
if (!token) throw new Error('LearnHouse seed login returned no access token');
const authHeaders = {authorization: `Bearer ${token}`, 'content-type': 'application/json'};

const org = await request('/api/v1/orgs/slug/phase-one');
if (!Number.isInteger(org?.id)) throw new Error('LearnHouse seed organization is missing');

const form = new FormData();
form.set('name', 'Evaluation Foundations');
form.set('description', 'Deterministic public course for capsule verification');
form.set('public', 'true');
form.set('about', 'A deterministic course used to verify generated WebMCP behavior.');
form.set('learnings', '[]');
form.set('tags', 'evaluation,webmcp');

const course = await request(`/api/v1/courses/?org_id=${org.id}`, {
  method: 'POST',
  headers: {authorization: `Bearer ${token}`},
  body: form,
});
if (!course?.course_uuid) throw new Error('LearnHouse seed course is missing a UUID');
if (!Number.isInteger(course?.id)) throw new Error('LearnHouse seed course is missing a numeric id');

await request(`/api/v1/courses/${course.course_uuid}`, {
  method: 'PUT',
  headers: authHeaders,
  body: JSON.stringify({public: true, published: true}),
});

// Structure: chapters + published lessons. A published course with no published
// activities makes the course page's server render 404 on its content fetch;
// deterministic chapters/lessons give the course-detail and enrollment journeys
// (and the frontend course page) real, renderable content. Course count stays 1.
const chapters = [
  {name: 'Foundations', lessons: ['What Evaluation Means', 'Setting Up Your First Test']},
  {name: 'Applied Practice', lessons: ['Reading the Results', 'Iterating on Findings']},
];
let publishedLessons = 0;
for (const spec of chapters) {
  const chapter = await request('/api/v1/chapters/', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({name: spec.name, org_id: org.id, course_id: course.id}),
  });
  if (!Number.isInteger(chapter?.id)) throw new Error(`LearnHouse seed chapter "${spec.name}" is missing an id`);
  for (const lessonName of spec.lessons) {
    const activity = await request('/api/v1/activities/', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        name: lessonName,
        chapter_id: chapter.id,
        activity_type: 'TYPE_DYNAMIC',
        activity_sub_type: 'SUBTYPE_DYNAMIC_PAGE',
        content: {type: 'doc', content: [{type: 'paragraph', content: [{type: 'text', text: `${lessonName}.`}]}]},
        published: true,
        lock_type: 'public',
      }),
    });
    if (!activity?.activity_uuid) throw new Error(`LearnHouse seed lesson "${lessonName}" is missing a UUID`);
    await request(`/api/v1/activities/${activity.activity_uuid}`, {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({published: true}),
    });
    publishedLessons += 1;
  }
}

const meta = await request(`/api/v1/courses/${course.course_uuid}/meta`);
const metaPublished = (meta?.chapters ?? []).flatMap((ch) => ch.activities ?? [])
  .filter((a) => a?.published === true).length;
if (metaPublished < publishedLessons) {
  throw new Error(`LearnHouse seed expected ${publishedLessons} published lessons, course meta reports ${metaPublished}`);
}

const visible = await request('/api/v1/courses/org_slug/phase-one/page/1/limit/10');
if (!Array.isArray(visible) || !visible.some((item) => item.name === 'Evaluation Foundations')) {
  throw new Error('LearnHouse seeded course is not anonymously visible');
}

process.stdout.write(`${JSON.stringify({
  orgId: org.id,
  orgSlug: org.slug,
  courseUuid: course.course_uuid,
  courseName: 'Evaluation Foundations',
  public: true,
  published: true,
  chapters: chapters.length,
  publishedLessons,
})}\n`);
