FROM alpine

RUN --mount=type=secret,id=secret,env=SECRET echo secret=$SECRET > secret.txt
RUN --mount=type=secret,id=secret_env,env=SECRET_ENV echo secret_env=$SECRET_ENV >> secret.txt
RUN --mount=type=secret,id=secret_file,target=/secret-file.txt cat secret-file.txt >> secret.txt

# To check the output of this run `docker container run <TAG> cat secret.txt`