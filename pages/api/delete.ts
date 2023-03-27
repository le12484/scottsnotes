import type {NextApiRequest, NextApiResponse} from 'next';
export interface UpdateRequest {
    memoryId: string;
    text: string;
}

async function updateScottsNotes(memoryId: string, text: string): Promise<any> {
    const data = {
        documents: [
            {
                id: memoryId,
                text,
            },
        ],
    };
    const url = 'https://scotts-notes.fly.dev/upsert'; // Replace this with the URL of the API you want to access
    const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.BEARER_TOKEN}`,
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(data),
        });

        if (response.ok) {
            const result = await response.json();
            // const texts = result.results[0].results.map((obj: any) => obj.text);
            return result;
        } else {
            console.error(
                `Request failed with status code: ${response.status}`,
            );
            return null;
        }
    } catch (error) {
        console.error('Fetch error:', error);
        return null;
    }
}

async function deleteScottsNote(memoryId: string): Promise<any> {
    const data = {
        ids: [memoryId],
    };
    console.log(data);
    const url = 'https://scotts-notes.fly.dev/delete'; // Replace this with the URL of the API you want to access
    const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.BEARER_TOKEN}`,
    };

    try {
        const response = await fetch(url, {
            method: 'DELETE',
            headers: headers,
            body: JSON.stringify(data),
        });

        if (response.ok) {
            const result = await response.json();
            // const texts = result.results[0].results.map((obj: any) => obj.text);
            return result;
        } else {
            console.error(
                `Request failed with status code: ${response.status}`,
            );
            return null;
        }
    } catch (error) {
        console.error('Fetch error:', error);
        return null;
    }
}

export default async function handler(
    req: NextApiRequest,
    res: NextApiResponse,
) {
    // console.log(req.body);
    const {memoryId}: UpdateRequest = req.body;
    await deleteScottsNote(memoryId);
    return res.status(200).json({message: 'success'});
}
